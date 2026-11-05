#include <emscripten/emscripten.h>

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <map>
#include <memory>
#include <numbers>
#include <optional>
#include <queue>
#include <string>
#include <string_view>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr int RowCount = 8'000'000;
constexpr int ColumnCount = 400;
constexpr int MaxInputBytes = 65'536;
constexpr int MaxTextBytes = 1'048'576;
constexpr int MaxFormulaDepth = 128;

enum class Kind { Blank, Number, Boolean, Text, Error };

struct Value {
    Kind kind = Kind::Blank;
    double number = 0;
    std::string text;

    static Value numeric(double value) {
        if (!std::isfinite(value)) return error("#NUM!");
        return {Kind::Number, value == 0 ? 0 : value, {}};
    }

    static Value boolean(bool value) {
        return {Kind::Boolean, value ? 1.0 : 0.0, {}};
    }

    static Value string(std::string value) {
        if (value.size() > MaxTextBytes) return error("#VALUE!");
        return {Kind::Text, 0, std::move(value)};
    }

    static Value error(std::string message) {
        return {Kind::Error, 0, std::move(message)};
    }

    bool failed() const { return kind == Kind::Error; }

    std::string display() const {
        if (kind == Kind::Number) {
            char buffer[64];
            const auto result = std::to_chars(buffer, buffer + sizeof(buffer), number,
                                              std::chars_format::general, 15);
            return std::string(buffer, result.ptr);
        }
        if (kind == Kind::Boolean) return number ? "TRUE" : "FALSE";
        return text;
    }
};

bool isDigit(char ch) { return ch >= '0' && ch <= '9'; }
bool isSpace(char ch) { return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n'; }
char upper(char ch) { return ch >= 'a' && ch <= 'z' ? ch - 'a' + 'A' : ch; }
bool isLetter(char ch) { return upper(ch) >= 'A' && upper(ch) <= 'Z'; }

std::string folded(std::string_view text) {
    std::string result(text);
    std::transform(result.begin(), result.end(), result.begin(), upper);
    return result;
}

std::string_view trim(std::string_view text) {
    while (!text.empty() && isSpace(text.front())) text.remove_prefix(1);
    while (!text.empty() && isSpace(text.back())) text.remove_suffix(1);
    return text;
}

bool parseNumber(std::string_view text, double& result) {
    text = trim(text);
    if (!text.empty() && text.front() == '+') {
        text.remove_prefix(1);
        if (!text.empty() && text.front() == '-') return false;
    }
    if (text.empty()) return false;
    const auto end = text.data() + text.size();
    const auto parsed = std::from_chars(text.data(), end, result, std::chars_format::general);
    return parsed.ptr == end && parsed.ec == std::errc{} && std::isfinite(result);
}

bool asNumber(const Value& value, double& number) {
    number = value.number;
    if (value.kind == Kind::Text) return parseNumber(value.text, number);
    return !value.failed();
}

bool asBoolean(const Value& value, bool& result) {
    if (value.kind == Kind::Text) {
        const auto word = folded(value.text);
        if (word == "TRUE" || word == "FALSE") {
            result = word == "TRUE";
            return true;
        }
    }
    double number;
    if (!asNumber(value, number)) return false;
    result = number != 0;
    return true;
}

bool wildcardMatch(std::string_view pattern, std::string_view text) {
    std::size_t p = 0, t = 0, star = std::string_view::npos, retry = 0;
    while (t < text.size()) {
        const bool escaped = p + 1 < pattern.size() && pattern[p] == '~' &&
            (pattern[p + 1] == '*' || pattern[p + 1] == '?' || pattern[p + 1] == '~');
        if (p < pattern.size() && !escaped && pattern[p] == '*') {
            star = ++p;
            retry = t;
        } else if (p < pattern.size() && ((!escaped && pattern[p] == '?') ||
                   upper(pattern[p + escaped]) == upper(text[t]))) {
            p += escaped ? 2 : 1;
            ++t;
        } else if (star != std::string_view::npos) {
            p = star;
            t = ++retry;
        } else return false;
    }
    while (p < pattern.size() && pattern[p] == '*') ++p;
    return p == pattern.size();
}

struct FormulaCache {
    std::uint64_t revision = 0;
    bool evaluating = false;
    Value value;
};

struct Cell {
    std::string input;
    std::unique_ptr<FormulaCache> formula;
};

struct Sheet {
    std::string name;
    std::array<std::map<int, Cell>, ColumnCount> columns;
};

struct Range {
    Sheet* sheet = nullptr;
    int firstRow = 0;
    int lastRow = 0;
    int firstColumn = 0;
    int lastColumn = 0;
};

struct Expression {
    Value value;
    Range range;
    Range reference = {};

    Range asRange() const { return range.sheet ? range : reference; }
};

std::map<int, Sheet> sheets;
std::unordered_map<std::string, Sheet*> sheetsByName;
std::uint64_t revision = 1;
std::array<char, MaxInputBytes + 1> inputBuffer;
std::string outputBuffer;
double resultNumber = 0;
int nextSheet = 1;

bool validCell(int row, int column) {
    return row >= 0 && row < RowCount && column >= 0 && column < ColumnCount;
}

Sheet* findSheet(int id) {
    const auto it = sheets.find(id);
    return it == sheets.end() ? nullptr : &it->second;
}

std::string_view readInput(int size) {
    return {inputBuffer.data(), static_cast<std::size_t>(std::clamp(size, 0, MaxInputBytes))};
}

Value calculate(Sheet& sheet, int row, int column, int depth);
Value calculateCell(Sheet& sheet, Cell& cell, int depth);

bool isErrorLiteral(std::string_view text) {
    return text == "#REF!" || text == "#DIV/0!" || text == "#VALUE!" || text == "#NAME?" ||
           text == "#NUM!" || text == "#N/A" || text == "#NULL!" || text == "#SPILL!" ||
           text == "#CALC!" || text == "#GETTING_DATA";
}

enum class Token { End, Number, Word, String, SheetName, Error, Symbol, LessEqual, GreaterEqual, NotEqual, Invalid };

struct Lexeme {
    Token token = Token::End;
    std::string_view text;
};

class Lexer {
public:
    explicit Lexer(std::string_view source) : source_(source) {}

    Lexeme next() {
        while (position_ < source_.size() && isSpace(source_[position_])) ++position_;
        if (position_ == source_.size()) return {};
        const auto start = position_++;
        const char ch = source_[start];
        const char following = peek();
        if (isDigit(ch) || (ch == '.' && isDigit(following))) {
            while (isDigit(peek())) ++position_;
            if (ch != '.' && peek() == '.') {
                ++position_;
                while (isDigit(peek())) ++position_;
            }
            if (upper(peek()) == 'E') {
                ++position_;
                if (peek() == '+' || peek() == '-') ++position_;
                while (isDigit(peek())) ++position_;
            }
            return slice(Token::Number, start);
        }
        if (isLetter(ch) || ch == '$' || ch == '_') {
            while (isLetter(peek()) || isDigit(peek()) || peek() == '$' || peek() == '_' || peek() == '.') {
                ++position_;
            }
            return slice(Token::Word, start);
        }
        if (ch == '"' || ch == '\'') {
            while (position_ < source_.size()) {
                if (source_[position_++] != ch) continue;
                if (peek() != ch) return slice(ch == '"' ? Token::String : Token::SheetName, start);
                ++position_;
            }
            return slice(Token::Invalid, start);
        }
        if (ch == '#') {
            constexpr std::string_view errors[] = {"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#NUM!",
                "#N/A", "#NULL!", "#SPILL!", "#CALC!", "#GETTING_DATA"};
            for (const auto error : errors) {
                if (source_.substr(start).starts_with(error)) {
                    position_ = start + error.size();
                    return slice(Token::Error, start);
                }
            }
        }
        if ((ch == '<' || ch == '>') && following == '=') {
            ++position_;
            return slice(ch == '<' ? Token::LessEqual : Token::GreaterEqual, start);
        }
        if (ch == '<' && following == '>') {
            ++position_;
            return slice(Token::NotEqual, start);
        }
        return slice(Token::Symbol, start);
    }

private:
    char peek() const { return position_ < source_.size() ? source_[position_] : '\0'; }
    Lexeme slice(Token token, std::size_t start) const {
        return {token, source_.substr(start, position_ - start)};
    }

    std::string_view source_;
    std::size_t position_ = 0;
};

std::string unquote(std::string_view text) {
    std::string result;
    for (std::size_t index = 1; index + 1 < text.size(); ++index) {
        result += text[index];
        if (text[index] == text.front()) ++index;
    }
    return result;
}

std::string quoteSheet(std::string_view name) {
    std::string quoted = "'";
    for (const char ch : name) {
        if (ch == '\'') quoted += '\'';
        quoted += ch;
    }
    return quoted + "'";
}

std::string replaceSheetReferences(std::string_view formula, std::string_view oldName,
                                   std::string_view newName) {
    Lexer lexer(formula);
    auto previous = lexer.next();
    std::string result;
    std::size_t copied = 0;
    for (auto next = lexer.next(); next.token != Token::End; previous = next, next = lexer.next()) {
        if (next.token != Token::Symbol || next.text != "!") continue;
        if (previous.token != Token::Word && previous.token != Token::SheetName) continue;
        const std::string name = previous.token == Token::SheetName ? unquote(previous.text)
                                                                   : std::string(previous.text);
        if (folded(name) != oldName) continue;
        const auto offset = static_cast<std::size_t>(previous.text.data() - formula.data());
        result += formula.substr(copied, offset - copied);
        result += newName;
        copied = offset + previous.text.size();
    }
    if (copied) result += formula.substr(copied);
    return result;
}

struct Address {
    int row = -1;
    int column = -1;
    bool valid = false;
};

Address readAddress(std::string_view text) {
    if (!text.empty() && text.front() == '$') text.remove_prefix(1);
    int column = 0;
    while (!text.empty() && isLetter(text.front())) {
        column = column * 26 + upper(text.front()) - 'A' + 1;
        if (column > ColumnCount) return {};
        text.remove_prefix(1);
    }
    if (column == 0) return {};
    if (text.empty()) return {-1, column - 1, true};
    if (text.front() == '$') text.remove_prefix(1);
    int row = 0;
    for (const char ch : text) {
        if (!isDigit(ch)) return {};
        row = row * 10 + ch - '0';
        if (row > RowCount) return {};
    }
    return {row - 1, column - 1, row > 0};
}

int precedence(const Lexeme& token) {
    if (token.token == Token::LessEqual || token.token == Token::GreaterEqual ||
        token.token == Token::NotEqual) return 1;
    if (token.token != Token::Symbol) return 0;
    switch (token.text.front()) {
        case '=': case '<': case '>': return 1;
        case '&': return 2;
        case '+': case '-': return 3;
        case '*': case '/': return 4;
        case '^': return 5;
        default: return 0;
    }
}

Value applyOperator(std::string_view symbol, const Value& left, const Value& right) {
    if (left.failed()) return left;
    if (right.failed()) return right;
    if (symbol == "&") return Value::string(left.display() + right.display());

    if (symbol == "=" || symbol == "<" || symbol == ">" ||
        symbol == "<=" || symbol == ">=" || symbol == "<>") {
        const bool textComparison = left.kind == Kind::Text || right.kind == Kind::Text;
        int order = 0;
        if (textComparison) {
            if (left.kind == Kind::Text && right.kind == Kind::Text) {
                order = folded(left.text).compare(folded(right.text));
            } else if (left.kind == Kind::Blank || right.kind == Kind::Blank) {
                order = folded(left.display()).compare(folded(right.display()));
            } else {
                order = left.kind == Kind::Text ? 1 : -1;
            }
        } else {
            order = (left.number > right.number) - (left.number < right.number);
        }
        if (symbol == "=") return Value::boolean(order == 0);
        if (symbol == "<>") return Value::boolean(order != 0);
        if (symbol == "<") return Value::boolean(order < 0);
        if (symbol == ">") return Value::boolean(order > 0);
        if (symbol == "<=") return Value::boolean(order <= 0);
        return Value::boolean(order >= 0);
    }

    double a, b;
    if (!asNumber(left, a) || !asNumber(right, b)) return Value::error("#VALUE!");
    if (symbol == "+") return Value::numeric(a + b);
    if (symbol == "-") return Value::numeric(a - b);
    if (symbol == "*") return Value::numeric(a * b);
    if (symbol == "/") return b == 0 ? Value::error("#DIV/0!") : Value::numeric(a / b);
    if (a == 0 && b < 0) return Value::error("#DIV/0!");
    return Value::numeric(std::pow(a, b));
}

struct Criterion {
    std::string_view op = "=";
    Value target;
    bool wildcard = false;

    explicit Criterion(const Value& value) : target(value) {
        if (value.kind != Kind::Text) return;
        std::string_view text = value.text;
        for (const std::string_view candidate : {"<>", ">=", "<=", "=", ">", "<"}) {
            if (!text.starts_with(candidate)) continue;
            op = candidate;
            text.remove_prefix(candidate.size());
            break;
        }
        double number;
        if (parseNumber(text, number)) target = Value::numeric(number);
        else if (folded(text) == "TRUE" || folded(text) == "FALSE") target = Value::boolean(folded(text) == "TRUE");
        else {
            wildcard = (op == "=" || op == "<>") && text.find_first_of("*?~") != std::string_view::npos;
            target = Value::string(std::string(text));
        }
    }

    bool matches(const Value& value) const {
        if (value.failed()) return target.kind == Kind::Text && (op == "=" || op == "<>") &&
            ((folded(value.text) == folded(target.text)) == (op == "="));
        if (wildcard) return (value.kind == Kind::Text && wildcardMatch(target.text, value.text)) == (op == "=");
        if (value.kind == Kind::Blank && target.kind != Kind::Text) return op == "<>";
        if (value.kind != Kind::Blank && value.kind != target.kind) return op == "<>";
        return applyOperator(op, value, target).number != 0;
    }
};

#include "calendar.inc"
#include "functions.inc"

class Parser {
public:
    Parser(std::string_view source, Sheet& sheet, int callDepth)
        : lexer_(source), current_(lexer_.next()), sheet_(sheet), callDepth_(callDepth) {}

    Value evaluate() {
        Value value = scalar(expression(1, true, 0));
        if (invalid_ || current_.token != Token::End) return Value::error("#FORMULA!");
        return value.kind == Kind::Blank ? Value::numeric(0) : value;
    }

private:
    bool symbol(char ch) const {
        return current_.token == Token::Symbol && current_.text.front() == ch;
    }

    Lexeme take() {
        const auto previous = current_;
        current_ = lexer_.next();
        return previous;
    }

    bool accept(char ch) {
        if (!symbol(ch)) return false;
        take();
        return true;
    }

    void expect(char ch) {
        if (!accept(ch)) invalid_ = true;
    }

    static Value scalar(Expression expression) {
        return expression.range.sheet ? Value::error("#VALUE!") : std::move(expression.value);
    }

    Expression expression(int minimum, bool run, int depth) {
        auto left = unary(run, depth);
        for (int level = precedence(current_); !invalid_ && level >= minimum;
             level = precedence(current_)) {
            const auto op = take();
            auto right = expression(level + 1, run, depth + 1);
            if (run) left = {applyOperator(op.text, scalar(std::move(left)), scalar(std::move(right))), {}};
        }
        return left;
    }

    Expression unary(bool run, int depth) {
        if (depth >= MaxFormulaDepth) {
            invalid_ = true;
            return {};
        }
        if (symbol('+') || symbol('-')) {
            const bool negative = take().text == "-";
            auto value = scalar(unary(run, depth + 1));
            if (!run || value.failed()) return {std::move(value), {}};
            double number;
            return {asNumber(value, number) ? Value::numeric(negative ? -number : number)
                                            : Value::error("#VALUE!"), {}};
        }
        auto result = primary(run, depth);
        while (accept('%')) {
            if (!run) continue;
            auto value = scalar(std::move(result));
            double number;
            if (value.failed()) result = {std::move(value), {}};
            else result = {asNumber(value, number) ? Value::numeric(number / 100)
                                                   : Value::error("#VALUE!"), {}};
        }
        return result;
    }

    Expression primary(bool run, int depth) {
        if (accept('(')) {
            auto result = expression(1, run, depth + 1);
            expect(')');
            return result;
        }
        const auto token = take();
        if (token.token == Token::Number) {
            double number;
            return {parseNumber(token.text, number) ? Value::numeric(number)
                                                   : Value::error("#NUM!"), {}};
        }
        if (token.token == Token::String) return {run ? Value::string(unquote(token.text)) : Value{}, {}};
        if (token.token == Token::Error) {
            if (accept(':')) take();
            return {Value::error(std::string(token.text)), {}};
        }
        if (token.token != Token::Word && token.token != Token::SheetName) {
            invalid_ = true;
            return {};
        }
        if (token.token == Token::Word && accept('(')) {
            return {function(folded(token.text), run, depth + 1), {}};
        }
        Sheet* target = &sheet_;
        auto address = token;
        if (accept('!')) {
            const auto name = folded(token.token == Token::SheetName ? unquote(token.text) : token.text);
            const auto found = sheetsByName.find(name);
            target = found == sheetsByName.end() ? nullptr : found->second;
            address = take();
        } else if (token.token == Token::Word && !symbol(':')) {
            const auto word = folded(token.text);
            if (word == "TRUE" || word == "FALSE") return {Value::boolean(word == "TRUE"), {}};
        }
        if (address.token != Token::Word) {
            invalid_ = true;
            return {};
        }
        const auto first = readAddress(address.text);
        if (accept(':')) {
            const auto endpoint = take();
            if (endpoint.token != Token::Word) {
                invalid_ = true;
                return {};
            }
            const auto last = readAddress(endpoint.text);
            if (!run) return {};
            if (!target || !first.valid || !last.valid || (first.row < 0) != (last.row < 0)) {
                return {Value::error("#REF!"), {}};
            }
            return {{}, {target,
                         first.row < 0 ? 0 : std::min(first.row, last.row),
                         first.row < 0 ? RowCount - 1 : std::max(first.row, last.row),
                         std::min(first.column, last.column), std::max(first.column, last.column)}};
        }
        if (!run) return {};
        if (first.valid && first.row >= 0 && target) {
            return {calculate(*target, first.row, first.column, callDepth_ + 1), {},
                    {target, first.row, first.row, first.column, first.column}};
        }
        const bool resemblesAddress = std::any_of(address.text.begin(), address.text.end(), isDigit);
        return {Value::error(!target || resemblesAddress ? "#REF!" : "#NAME?"), {}};
    }

    Value conditional(const std::string& name, bool run, int depth) {
        auto first = scalar(expression(1, run, depth));
        expect(',');
        if (name == "IFERROR" || name == "IFNA") {
            const bool recover = run && first.failed() && first.text != "#CYCLE!" && first.text != "#DEPTH!" &&
                (name == "IFERROR" || first.text == "#N/A");
            auto fallback = scalar(expression(1, recover, depth));
            expect(')');
            return recover ? fallback : first;
        }
        bool condition = false;
        const bool validCondition = run && asBoolean(first, condition);
        auto whenTrue = scalar(expression(1, validCondition && condition, depth));
        Value whenFalse = Value::boolean(false);
        if (accept(',')) whenFalse = scalar(expression(1, validCondition && !condition, depth));
        expect(')');
        if (!run) return {};
        if (first.failed()) return first;
        if (!validCondition) return Value::error("#VALUE!");
        return condition ? whenTrue : whenFalse;
    }

    Value function(std::string name, bool run, int depth) {
        if (name.starts_with("_XLFN.")) name.erase(0, 6);
        if (name == "IF" || name == "IFERROR" || name == "IFNA") return conditional(name, run, depth);
        std::vector<Expression> args;
        if (!accept(')')) {
            do {
                if (invalid_ || args.size() >= 255) {
                    invalid_ = true;
                    return {};
                }
                args.push_back(expression(1, run, depth));
            } while (accept(','));
            expect(')');
        }
        if (!run || invalid_) return {};
        for (const auto& arg : args) {
            if (arg.value.failed() && (arg.value.text == "#CYCLE!" || arg.value.text == "#DEPTH!")) return arg.value;
        }
        if (name == "SUMIFS" || name == "COUNTIFS" || name == "AVERAGEIFS" ||
            name == "MINIFS" || name == "MAXIFS") return multiCriteria(name, args);
        if (name == "COUNTBLANK" || name == "MEDIAN" || name == "LARGE" || name == "SMALL" ||
            name == "STDEV" || name == "STDEVP" || name == "STDEV.S" || name == "STDEV.P" ||
            name == "VAR" || name == "VARP" || name == "VAR.S" || name == "VAR.P" ||
            name == "SUMSQ" || name == "TEXTJOIN" || name == "NPV") return extraAggregate(name, args);
        if (name == "SUMPRODUCT") return sumProduct(args);
        if (name == "ROWS" || name == "COLUMNS") {
            if (args.size() != 1) return Value::error("#VALUE!");
            const auto range = args[0].asRange();
            if (!range.sheet) return args[0].value.failed() ? args[0].value : Value::numeric(1);
            return Value::numeric(name == "ROWS" ? range.lastRow - range.firstRow + 1
                                                : range.lastColumn - range.firstColumn + 1);
        }
        if (name == "CHOOSE") {
            if (args.size() < 2) return Value::error("#VALUE!");
            const auto index = scalar(args[0]);
            double number;
            if (index.failed()) return index;
            if (!asNumber(index, number) || number < 1 || number >= args.size()) return Value::error("#VALUE!");
            return scalar(args[static_cast<std::size_t>(number)]);
        }
        std::vector<Value> scalarArgs;
        scalarArgs.reserve(args.size());
        for (const auto& arg : args) scalarArgs.push_back(scalar(arg));
        if (const auto value = calendarFunction(name, scalarArgs)) return *value;
        if (const auto value = typeFunction(name, scalarArgs)) return *value;
        const Arguments scalarFunctions{scalarArgs};
        if (const auto value = mathFunction(name, scalarFunctions)) return *value;
        if (const auto value = textFunction(name, scalarFunctions)) return *value;
        if (const auto value = financialFunction(name, scalarFunctions)) return *value;
        if (name == "COUNTIF" || name == "SUMIF" || name == "AVERAGEIF") return conditionalAggregate(name, args);
        if (name == "VLOOKUP" || name == "XLOOKUP" || name == "MATCH" || name == "INDEX") return lookup(name, args);
        if (name == "SUM" || name == "AVERAGE" || name == "MIN" || name == "MAX" ||
            name == "COUNT" || name == "COUNTA" || name == "PRODUCT" ||
            name == "AND" || name == "OR" || name == "CONCAT") {
            return aggregate(name, args);
        }
        if (name == "PI" && args.empty()) return Value::numeric(3.141592653589793);
        const bool twoArgs = name == "ROUND" || name == "MOD";
        const bool recognized = twoArgs || name == "ABS" || name == "INT" || name == "SQRT" ||
                                name == "NOT" || name == "LEN" || name == "UPPER" ||
                                name == "LOWER" || name == "TRIM";
        if (!recognized) return Value::error("#NAME?");
        if (args.size() != (twoArgs ? 2u : 1u)) return Value::error("#VALUE!");
        auto first = scalar(std::move(args[0]));
        if (first.failed()) return first;
        if (name == "NOT") {
            bool truth;
            return asBoolean(first, truth) ? Value::boolean(!truth) : Value::error("#VALUE!");
        }
        if (name == "LEN" || name == "UPPER" || name == "LOWER" || name == "TRIM") {
            auto text = first.display();
            if (name == "LEN") {
                const auto count = std::count_if(text.begin(), text.end(), [](unsigned char ch) {
                    return (ch & 0xC0) != 0x80;
                });
                return Value::numeric(count);
            }
            if (name == "UPPER") return Value::string(folded(text));
            if (name == "LOWER") {
                for (char& ch : text) if (ch >= 'A' && ch <= 'Z') ch += 'a' - 'A';
                return Value::string(std::move(text));
            }
            std::string cleaned;
            bool pendingSpace = false;
            for (const char ch : trim(text)) {
                if (ch == ' ') pendingSpace = true;
                else {
                    if (pendingSpace) cleaned += ' ';
                    cleaned += ch;
                    pendingSpace = false;
                }
            }
            return Value::string(std::move(cleaned));
        }
        double a, b;
        if (!asNumber(first, a)) return Value::error("#VALUE!");
        if (name == "ABS") return Value::numeric(std::abs(a));
        if (name == "INT") return Value::numeric(std::floor(a));
        if (name == "SQRT") return Value::numeric(std::sqrt(a));
        auto second = scalar(std::move(args[1]));
        if (second.failed()) return second;
        if (!asNumber(second, b)) return Value::error("#VALUE!");
        if (name == "MOD") {
            if (b == 0) return Value::error("#DIV/0!");
            const double remainder = std::fmod(a, b);
            return Value::numeric(remainder != 0 && std::signbit(remainder) != std::signbit(b)
                                      ? remainder + b : remainder);
        }
        const auto places = std::clamp(std::trunc(b), -308.0, 308.0);
        const auto factor = std::pow(10.0, places);
        const auto scaled = a * factor;
        return Value::numeric(std::isfinite(scaled) ? std::round(scaled) / factor : a);
    }

    Value rangeValue(const Range& range, int row, int column) const {
        if (!validCell(row, column)) return Value::error("#REF!");
        return calculate(*range.sheet, row, column, callDepth_ + 1);
    }

    template <typename Consumer>
    Value forRange(const Range& range, Consumer consume, bool rowMajor = false) const {
        if (!rowMajor) {
            for (int column = range.firstColumn; column <= range.lastColumn; ++column) {
                auto& cells = range.sheet->columns[column];
                for (auto it = cells.lower_bound(range.firstRow); it != cells.end() && it->first <= range.lastRow; ++it) {
                    auto result = consume(calculateCell(*range.sheet, it->second, callDepth_ + 1), it->first, column);
                    if (result.failed()) return result;
                }
            }
            return {};
        }
        using Coordinate = std::pair<int, int>;
        std::priority_queue<Coordinate, std::vector<Coordinate>, std::greater<Coordinate>> queue;
        std::array<std::map<int, Cell>::iterator, ColumnCount> cursors;
        const auto add = [&](int column) {
            const auto cursor = cursors[column];
            if (cursor != range.sheet->columns[column].end() && cursor->first <= range.lastRow) {
                queue.emplace(cursor->first, column);
            }
        };
        for (int column = range.firstColumn; column <= range.lastColumn; ++column) {
            cursors[column] = range.sheet->columns[column].lower_bound(range.firstRow);
            add(column);
        }
        while (!queue.empty()) {
            const auto [row, column] = queue.top();
            queue.pop();
            auto result = consume(calculateCell(*range.sheet, cursors[column]++->second, callDepth_ + 1), row, column);
            if (result.failed()) return result;
            add(column);
        }
        return {};
    }

    Value multiCriteria(std::string_view name, const std::vector<Expression>& args) const {
        const bool count = name == "COUNTIFS";
        const std::size_t first = count ? 0 : 1;
        const auto invalid = Value::error("#VALUE!");
        if (args.size() < first + 2 || (args.size() - first) % 2) return invalid;
        const auto measure = args[0].asRange();
        if (!measure.sheet) return args[0].value.failed() ? args[0].value : invalid;
        const int height = measure.lastRow - measure.firstRow + 1;
        const int width = measure.lastColumn - measure.firstColumn + 1;
        std::vector<std::pair<Range, Criterion>> conditions;
        int requiredOccupied = -1;
        for (std::size_t index = first; index < args.size(); index += 2) {
            const auto range = args[index].asRange();
            const auto target = scalar(args[index + 1]);
            if (target.failed()) return target;
            if (!range.sheet || range.lastRow - range.firstRow + 1 != height ||
                range.lastColumn - range.firstColumn + 1 != width) return invalid;
            conditions.emplace_back(range, Criterion(target));
            if (requiredOccupied == -1 && !conditions.back().second.matches({})) {
                requiredOccupied = static_cast<int>(conditions.size()) - 1;
            }
        }
        const auto matches = [&](int rowOffset, int columnOffset, bool& result) -> Value {
            result = false;
            for (const auto& [range, criterion] : conditions) {
                const auto value = rangeValue(range, range.firstRow + rowOffset, range.firstColumn + columnOffset);
                if (value.failed() && (value.text == "#CYCLE!" || value.text == "#DEPTH!")) return value;
                if (!criterion.matches(value)) return {};
            }
            result = true;
            return {};
        };
        std::int64_t total = 0;
        double sum = 0, extreme = 0;
        if (count && requiredOccupied == -1) {
            // All criteria match a blank cell. Visit the union of occupied rows
            // in each column and account for the remaining cells in one step.
            total = std::int64_t(height) * width;
            std::vector<std::map<int, Cell>::const_iterator> cursors(conditions.size());
            for (int column = 0; column < width; ++column) {
                using Coordinate = std::pair<int, std::size_t>;
                std::priority_queue<Coordinate, std::vector<Coordinate>, std::greater<Coordinate>> queue;
                const auto enqueue = [&](std::size_t index) {
                    const auto& range = conditions[index].first;
                    const auto& cells = range.sheet->columns[range.firstColumn + column];
                    const auto cursor = cursors[index];
                    if (cursor != cells.end() && cursor->first <= range.lastRow) {
                        queue.emplace(cursor->first - range.firstRow, index);
                    }
                };
                for (std::size_t index = 0; index < conditions.size(); ++index) {
                    const auto& range = conditions[index].first;
                    cursors[index] = range.sheet->columns[range.firstColumn + column].lower_bound(range.firstRow);
                    enqueue(index);
                }
                while (!queue.empty()) {
                    const int row = queue.top().first;
                    do {
                        const auto index = queue.top().second;
                        queue.pop();
                        ++cursors[index];
                        enqueue(index);
                    } while (!queue.empty() && queue.top().first == row);
                    bool accepted;
                    if (auto error = matches(row, column, accepted); error.failed()) return error;
                    if (!accepted) --total;
                }
            }
            return Value::numeric(total);
        }
        const auto scan = count ? conditions[requiredOccupied].first : measure;
        const auto error = forRange(scan, [&](const Value& value, int row, int column) -> Value {
            bool accepted;
            if (auto failure = matches(row - scan.firstRow, column - scan.firstColumn, accepted); failure.failed()) return failure;
            if (!accepted) return {};
            if (count) { ++total; return {}; }
            if (value.failed()) return value;
            if (value.kind != Kind::Number) return {};
            sum += value.number;
            if (!total) extreme = value.number;
            else if (name == "MINIFS") extreme = std::min(extreme, value.number);
            else if (name == "MAXIFS") extreme = std::max(extreme, value.number);
            ++total;
            return {};
        });
        if (error.failed()) return error;
        if (count) return Value::numeric(total);
        if (name == "AVERAGEIFS") return total ? Value::numeric(sum / total) : Value::error("#DIV/0!");
        return Value::numeric(name == "SUMIFS" ? sum : extreme);
    }

    Value sumProduct(const std::vector<Expression>& args) const {
        if (args.empty()) return Value::error("#VALUE!");
        const auto first = args.front().asRange();
        if (!first.sheet) {
            double product = 1;
            for (const auto& arg : args) {
                if (arg.value.failed()) return arg.value;
                if (arg.range.sheet) return Value::error("#VALUE!");
                product *= arg.value.kind == Kind::Number ? arg.value.number : 0;
            }
            return Value::numeric(product);
        }
        std::vector<Range> ranges;
        for (const auto& arg : args) {
            if (arg.value.failed()) return arg.value;
            const auto range = arg.asRange();
            if (!range.sheet || first.lastRow - first.firstRow != range.lastRow - range.firstRow ||
                first.lastColumn - first.firstColumn != range.lastColumn - range.firstColumn) return Value::error("#VALUE!");
            ranges.push_back(range);
        }
        // Errors in any operand propagate, including where another range is blank.
        for (std::size_t index = 1; index < ranges.size(); ++index) {
            const auto error = forRange(ranges[index], [](const Value& value, int, int) -> Value {
                return value.failed() ? value : Value{};
            });
            if (error.failed()) return error;
        }
        double sum = 0;
        const auto error = forRange(first, [&](const Value& value, int row, int column) -> Value {
            if (value.failed()) return value;
            if (value.kind != Kind::Number || value.number == 0) return {};
            double product = value.number;
            for (std::size_t index = 1; index < ranges.size() && product != 0; ++index) {
                const auto& range = ranges[index];
                const auto operand = rangeValue(range, range.firstRow + row - first.firstRow,
                                                 range.firstColumn + column - first.firstColumn);
                product *= operand.kind == Kind::Number ? operand.number : 0;
            }
            sum += product;
            return {};
        });
        return error.failed() ? error : Value::numeric(sum);
    }

    Value extraAggregate(std::string_view name, const std::vector<Expression>& args) const {
        const auto invalid = Value::error("#VALUE!");
        if (args.empty()) return invalid;
        if (name == "COUNTBLANK") {
            const auto range = args[0].asRange();
            if (args.size() != 1 || !range.sheet) return invalid;
            std::int64_t blank = std::int64_t(range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);
            auto error = forRange(range, [&](const Value& value, int, int) -> Value {
                if (value.failed() && (value.text == "#CYCLE!" || value.text == "#DEPTH!")) return value;
                if (value.kind != Kind::Blank && !(value.kind == Kind::Text && value.text.empty())) --blank;
                return {};
            });
            return error.failed() ? error : Value::numeric(blank);
        }
        const bool rank = name == "LARGE" || name == "SMALL";
        const bool join = name == "TEXTJOIN";
        const bool npv = name == "NPV";
        if ((rank && args.size() != 2) || (join && args.size() < 3) || (npv && args.size() < 2)) return invalid;
        bool ignoreEmpty = false;
        std::string delimiter;
        double rate = 0, discount = 1;
        if (join) {
            const auto text = scalar(args[0]), ignore = scalar(args[1]);
            if (text.failed()) return text;
            if (ignore.failed()) return ignore;
            delimiter = text.display();
            if (!asBoolean(ignore, ignoreEmpty)) return invalid;
        }
        if (npv) {
            if (!asNumber(scalar(args[0]), rate)) return invalid;
            if (rate == -1) return Value::error("#DIV/0!");
        }
        std::string joined;
        bool wrote = false;
        std::int64_t count = 0;
        double sum = 0, mean = 0, squaredDeviation = 0;
        std::vector<double> ordered;
        const auto consume = [&](const Value& value, bool reference) -> Value {
            if (value.failed()) return value;
            if (join) {
                const auto text = value.display();
                if (ignoreEmpty && text.empty()) return {};
                if (wrote) joined += delimiter;
                joined += text;
                wrote = true;
                return joined.size() > MaxTextBytes ? invalid : Value{};
            }
            double number;
            if (reference && value.kind != Kind::Number) return {};
            if (!asNumber(value, number)) return invalid;
            if (rank || name == "MEDIAN") ordered.push_back(number);
            ++count;
            const double delta = number - mean;
            mean += delta / count;
            squaredDeviation += delta * (number - mean);
            if (npv) {
                discount *= 1 + rate;
                sum += number / discount;
            } else sum += number * number;
            return {};
        };
        const std::size_t first = join ? 2 : npv ? 1 : 0;
        for (std::size_t index = first; index < (rank ? 1u : args.size()); ++index) {
            const auto& arg = args[index];
            const auto& range = arg.range;
            Value error;
            if (!range.sheet) error = consume(arg.value, arg.reference.sheet != nullptr);
            else if (join && !ignoreEmpty) {
                const auto size = std::int64_t(range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);
                if (!delimiter.empty() && size - 1 > MaxTextBytes / delimiter.size()) return invalid;
                if (delimiter.empty()) {
                    error = forRange(range, [&](const Value& value, int, int) { return consume(value, true); }, true);
                } else {
                    for (int row = range.firstRow; row <= range.lastRow && !error.failed(); ++row) {
                        for (int column = range.firstColumn; column <= range.lastColumn && !error.failed(); ++column) {
                            error = consume(rangeValue(range, row, column), true);
                        }
                    }
                }
            } else error = forRange(range, [&](const Value& value, int, int) { return consume(value, true); }, join || npv);
            if (error.failed()) return error;
        }
        if (join) return Value::string(std::move(joined));
        if (name == "SUMSQ" || npv) return Value::numeric(sum);
        if (rank || name == "MEDIAN") {
            if (ordered.empty()) return Value::error("#NUM!");
            std::size_t position = ordered.size() / 2;
            if (rank) {
                double k;
                if (!asNumber(scalar(args[1]), k) || k < 1 || k >= ordered.size() + 1) return Value::error("#NUM!");
                position = static_cast<std::size_t>(k) - 1;
                if (name == "LARGE") position = ordered.size() - position - 1;
            }
            std::nth_element(ordered.begin(), ordered.begin() + position, ordered.end());
            const double value = ordered[position];
            if (rank || ordered.size() % 2) return Value::numeric(value);
            return Value::numeric(value / 2 + *std::max_element(ordered.begin(), ordered.begin() + position) / 2);
        }
        const bool sample = name == "STDEV" || name == "VAR" || name.ends_with(".S");
        const auto denominator = count - (sample ? 1 : 0);
        if (denominator <= 0) return Value::error("#DIV/0!");
        const double variance = std::max(0.0, squaredDeviation / denominator);
        return Value::numeric(name.starts_with("STDEV") ? std::sqrt(variance) : variance);
    }

    Value conditionalAggregate(const std::string& name, const std::vector<Expression>& args) {
        const bool countOnly = name == "COUNTIF";
        if (args.size() < 2 || args.size() > (countOnly ? 2u : 3u)) return Value::error("#VALUE!");
        const auto criteriaRange = args[0].asRange();
        auto sumRange = args.size() == 3 ? args[2].asRange() : criteriaRange;
        if (args[0].value.failed()) return args[0].value;
        if (args.size() == 3 && args[2].value.failed()) return args[2].value;
        if (!criteriaRange.sheet || !sumRange.sheet) return Value::error("#VALUE!");
        const auto& argument = args[1];
        if (argument.value.failed()) return argument.value;
        if (argument.range.sheet) return Value::error("#VALUE!");
        const Criterion criterion(argument.value);
        const bool matchesBlank = criterion.matches({});
        const int height = criteriaRange.lastRow - criteriaRange.firstRow + 1;
        const int width = criteriaRange.lastColumn - criteriaRange.firstColumn + 1;
        sumRange.lastRow = std::min(RowCount - 1, sumRange.firstRow + height - 1);
        sumRange.lastColumn = std::min(ColumnCount - 1, sumRange.firstColumn + width - 1);
        const bool scanSum = matchesBlank && !countOnly;
        const auto& scan = scanSum ? sumRange : criteriaRange;
        std::int64_t count = 0, visited = 0;
        double sum = 0;
        for (int column = scan.firstColumn; column <= scan.lastColumn; ++column) {
            auto& cells = scan.sheet->columns[column];
            for (auto it = cells.lower_bound(scan.firstRow);
                 it != cells.end() && it->first <= scan.lastRow; ++it) {
                const int rowOffset = it->first - scan.firstRow;
                const int columnOffset = column - scan.firstColumn;
                const auto value = scanSum
                    ? rangeValue(criteriaRange, criteriaRange.firstRow + rowOffset, criteriaRange.firstColumn + columnOffset)
                    : calculateCell(*scan.sheet, it->second, callDepth_ + 1);
                if (value.failed() && (value.text == "#CYCLE!" || value.text == "#DEPTH!")) return value;
                ++visited;
                if (!criterion.matches(value)) continue;
                if (!countOnly) {
                    const auto numeric = scanSum
                        ? calculateCell(*scan.sheet, it->second, callDepth_ + 1)
                        : rangeValue(sumRange, sumRange.firstRow + rowOffset, sumRange.firstColumn + columnOffset);
                    if (numeric.failed()) return numeric;
                    if (numeric.kind != Kind::Number) continue;
                    sum += numeric.number;
                }
                ++count;
            }
        }
        if (countOnly) return Value::numeric(count + (matchesBlank ? std::int64_t(height) * width - visited : 0));
        if (name == "AVERAGEIF") return count ? Value::numeric(sum / count) : Value::error("#DIV/0!");
        return Value::numeric(sum);
    }

    Value lookup(const std::string& name, const std::vector<Expression>& args) {
        const auto scalarAt = [&](std::size_t index) {
            return args[index].range.sheet ? Value::error("#VALUE!") : args[index].value;
        };
        if (name == "INDEX") {
            if (args.size() < 2 || args.size() > 3 || !args[0].asRange().sheet) return Value::error("#VALUE!");
            const auto range = args[0].asRange();
            double row, column = 1;
            if (!asNumber(scalarAt(1), row) || (args.size() == 3 && !asNumber(scalarAt(2), column))) {
                return Value::error("#VALUE!");
            }
            if (args.size() == 2 && range.firstRow == range.lastRow) {
                column = row;
                row = 1;
            }
            if (row < 1 || column < 1 || row >= range.lastRow - range.firstRow + 2 ||
                column >= range.lastColumn - range.firstColumn + 2) return Value::error("#REF!");
            return rangeValue(range, range.firstRow + static_cast<int>(row) - 1,
                              range.firstColumn + static_cast<int>(column) - 1);
        }

        const bool verticalTable = name == "VLOOKUP";
        const bool matchOnly = name == "MATCH";
        const std::size_t minimum = matchOnly ? 2 : 3;
        const std::size_t maximum = matchOnly ? 3 : verticalTable ? 4 : 6;
        if (args.size() < minimum || args.size() > maximum || !args[1].asRange().sheet) return Value::error("#VALUE!");
        const auto needle = scalarAt(0);
        if (needle.failed()) return needle;
        const auto keys = args[1].asRange();
        const bool vertical = verticalTable || keys.firstColumn == keys.lastColumn;
        if (!vertical && keys.firstRow != keys.lastRow) return Value::error("#VALUE!");
        const int length = vertical ? keys.lastRow - keys.firstRow + 1 : keys.lastColumn - keys.firstColumn + 1;
        int offset = 0;
        double mode = 0;
        double search = 1;
        Range results = keys;
        if (verticalTable) {
            double index;
            bool approximate = true;
            if (!asNumber(scalarAt(2), index) || index < 1) return Value::error("#VALUE!");
            if (index >= keys.lastColumn - keys.firstColumn + 2) return Value::error("#REF!");
            if (args.size() == 4 && !asBoolean(scalarAt(3), approximate)) return Value::error("#VALUE!");
            offset = static_cast<int>(index) - 1;
            mode = approximate ? -1 : 2;
        } else if (matchOnly) {
            mode = 1;
            if (args.size() == 3 && !asNumber(scalarAt(2), mode)) return Value::error("#VALUE!");
            if (mode != 0 && mode != 1 && mode != -1) return Value::error("#VALUE!");
            mode = mode == 0 ? 2 : -mode;
        } else {
            results = args[2].asRange();
            if (!results.sheet || (args.size() >= 5 && !asNumber(scalarAt(4), mode)) ||
                (args.size() == 6 && !asNumber(scalarAt(5), search))) return Value::error("#VALUE!");
            if (mode != 0 && mode != 1 && mode != -1 && mode != 2) return Value::error("#VALUE!");
            if (search != 1 && search != -1) return Value::error("#VALUE!");
            const int height = results.lastRow - results.firstRow + 1;
            const int width = results.lastColumn - results.firstColumn + 1;
            if (vertical ? (height != length || width != 1) : (width != length || height != 1)) {
                return Value::error("#VALUE!");
            }
        }
        const auto result = [&](int index) {
            if (matchOnly) return Value::numeric(index + 1);
            return rangeValue(results, results.firstRow + (vertical ? index : 0),
                              results.firstColumn + (vertical ? offset : index));
        };
        int best = -1;
        Value bestKey;
        const auto consider = [&](const Value& value, int index) {
            if (value.kind == Kind::Blank || value.failed() || value.kind != needle.kind) return false;
            const bool equals = mode == 2 && needle.kind == Kind::Text
                ? wildcardMatch(needle.text, value.text) : applyOperator("=", value, needle).number != 0;
            if (equals) {
                best = index;
                return true;
            }
            if ((mode == -1 && applyOperator("<", value, needle).number) ||
                (mode == 1 && applyOperator(">", value, needle).number)) {
                if (best < 0 || applyOperator(mode == -1 ? ">" : "<", value, bestKey).number) {
                    best = index;
                    bestKey = value;
                }
            }
            return false;
        };
        if (vertical) {
            auto& cells = keys.sheet->columns[keys.firstColumn];
            if (search == 1) {
                for (auto it = cells.lower_bound(keys.firstRow); it != cells.end() && it->first <= keys.lastRow; ++it) {
                    const auto value = calculateCell(*keys.sheet, it->second, callDepth_ + 1);
                    if (value.failed() && (value.text == "#CYCLE!" || value.text == "#DEPTH!")) return value;
                    if (consider(value, it->first - keys.firstRow)) break;
                }
            } else {
                for (auto it = cells.upper_bound(keys.lastRow); it != cells.begin();) {
                    --it;
                    if (it->first < keys.firstRow) break;
                    const auto value = calculateCell(*keys.sheet, it->second, callDepth_ + 1);
                    if (value.failed() && (value.text == "#CYCLE!" || value.text == "#DEPTH!")) return value;
                    if (consider(value, it->first - keys.firstRow)) break;
                }
            }
        } else {
            for (int n = 0; n < length; ++n) {
                const int index = search == 1 ? n : length - n - 1;
                const auto value = rangeValue(keys, keys.firstRow, keys.firstColumn + index);
                if (value.failed() && (value.text == "#CYCLE!" || value.text == "#DEPTH!")) return value;
                if (consider(value, index)) break;
            }
        }
        if (best >= 0) return result(best);
        return name == "XLOOKUP" && args.size() >= 4 ? scalarAt(3) : Value::error("#N/A");
    }

    Value aggregate(const std::string& name, const std::vector<Expression>& args) {
        double sum = 0, product = 1, min = 0, max = 0;
        std::int64_t count = 0, nonblank = 0, logicalCount = 0;
        bool all = true, any = false;
        std::string text;
        const bool countOnly = name == "COUNT" || name == "COUNTA";
        const bool logical = name == "AND" || name == "OR";
        const bool concatenate = name == "CONCAT";

        const auto consume = [&](const Value& value, bool fromRange) -> Value {
            if (value.failed() && (!countOnly || value.text == "#CYCLE!" || value.text == "#DEPTH!")) {
                return value;
            }
            if (value.kind == Kind::Blank) return {};
            ++nonblank;
            if (name == "COUNTA") return {};
            if (concatenate) {
                text += value.display();
                return text.size() > MaxTextBytes ? Value::error("#VALUE!") : Value{};
            }
            if (logical) {
                if (fromRange && value.kind == Kind::Text) return {};
                bool truth;
                if (!asBoolean(value, truth)) return Value::error("#VALUE!");
                ++logicalCount;
                all &= truth;
                any |= truth;
                return {};
            }
            double number = value.number;
            if (fromRange && value.kind != Kind::Number) return {};
            if (!asNumber(value, number)) return countOnly ? Value{} : Value::error("#VALUE!");
            sum += number;
            if (name == "PRODUCT") product *= number;
            min = count ? std::min(min, number) : number;
            max = count ? std::max(max, number) : number;
            ++count;
            return {};
        };

        for (const auto& arg : args) {
            const auto& range = arg.range;
            if (!range.sheet) {
                auto error = consume(arg.value, arg.reference.sheet != nullptr);
                if (error.failed()) return error;
                continue;
            }
            // Visit only occupied cells. A whole-column range costs one lower_bound
            // and one visit per stored cell, independent of the worksheet height.
            for (int column = range.firstColumn; column <= range.lastColumn; ++column) {
                auto& cells = range.sheet->columns[column];
                for (auto it = cells.lower_bound(range.firstRow);
                     it != cells.end() && it->first <= range.lastRow; ++it) {
                    auto error = consume(calculateCell(*range.sheet, it->second, callDepth_ + 1), true);
                    if (error.failed()) return error;
                }
            }
        }
        if (name == "COUNT") return Value::numeric(count);
        if (name == "COUNTA") return Value::numeric(nonblank);
        if (name == "MIN") return Value::numeric(min);
        if (name == "MAX") return Value::numeric(max);
        if (name == "PRODUCT") return Value::numeric(count ? product : 0);
        if (name == "AVERAGE") return count ? Value::numeric(sum / count) : Value::error("#DIV/0!");
        if (logical) return logicalCount ? Value::boolean(name == "AND" ? all : any) : Value::error("#VALUE!");
        if (concatenate) return Value::string(std::move(text));
        return Value::numeric(sum);
    }

    Lexer lexer_;
    Lexeme current_;
    Sheet& sheet_;
    int callDepth_;
    bool invalid_ = false;
};

Value calculate(Sheet& sheet, int row, int column, int depth) {
    const auto it = sheet.columns[column].find(row);
    if (it == sheet.columns[column].end()) return {};
    return calculateCell(sheet, it->second, depth);
}

Value calculateCell(Sheet& sheet, Cell& cell, int depth) {
    if (!cell.formula) {
        const std::string_view input = cell.input;
        if (input.front() == '\'') return Value::string(std::string(input.substr(1)));
        if (input.front() == '#' && isErrorLiteral(input)) return Value::error(cell.input);
        double number;
        if (parseNumber(input, number)) return Value::numeric(number);
        if (input.size() == 4 || input.size() == 5) {
            const auto word = folded(input);
            if (word == "TRUE" || word == "FALSE") return Value::boolean(word == "TRUE");
        }
        return Value::string(cell.input);
    }
    auto& cache = *cell.formula;
    if (cache.revision == revision) return cache.value;
    if (cache.evaluating) return Value::error("#CYCLE!");
    if (depth >= MaxFormulaDepth) return Value::error("#DEPTH!");
    cache.evaluating = true;
    auto value = Parser(std::string_view(cell.input).substr(1), sheet, depth).evaluate();
    cache.evaluating = false;
    // Depth failures depend on the starting cell and must not poison its cache.
    if (value.kind != Kind::Error || value.text != "#DEPTH!") {
        cache.revision = revision;
        cache.value = value;
    }
    return value;
}

#include "pivot.inc"

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int workbook_rows() { return RowCount; }
EMSCRIPTEN_KEEPALIVE int workbook_columns() { return ColumnCount; }
EMSCRIPTEN_KEEPALIVE int workbook_input_limit() { return MaxInputBytes; }
EMSCRIPTEN_KEEPALIVE char* workbook_input() { return inputBuffer.data(); }
EMSCRIPTEN_KEEPALIVE const char* workbook_output() { return outputBuffer.data(); }
EMSCRIPTEN_KEEPALIVE int workbook_output_size() { return outputBuffer.size(); }
EMSCRIPTEN_KEEPALIVE double workbook_number() { return resultNumber; }

EMSCRIPTEN_KEEPALIVE int workbook_add_sheet(int size) {
    const auto name = readInput(size);
    if (name.empty() || name.size() > 128) return 0;
    auto key = folded(name);
    if (sheetsByName.contains(key)) return 0;
    const int id = nextSheet++;
    auto& sheet = sheets[id];
    sheet.name = name;
    sheetsByName.emplace(std::move(key), &sheet);
    ++revision;
    return id;
}

EMSCRIPTEN_KEEPALIVE int workbook_remove_sheet(int id) {
    auto* sheet = findSheet(id);
    if (!sheet) return 0;
    sheetsByName.erase(folded(sheet->name));
    sheets.erase(id);
    ++revision;
    return 1;
}

EMSCRIPTEN_KEEPALIVE int workbook_rename_sheet(int id, int size) {
    auto* target = findSheet(id);
    const auto name = readInput(size);
    if (!target || name.empty() || name.size() > 128) return 0;
    auto newKey = folded(name);
    const auto oldKey = folded(target->name);
    if (newKey != oldKey && sheetsByName.contains(newKey)) return 0;
    const auto quotedName = quoteSheet(name);
    std::vector<std::pair<Cell*, std::string>> changes;
    for (auto& entry : sheets) {
        for (auto& column : entry.second.columns) {
            for (auto& [row, cell] : column) {
                if (!cell.formula) continue;
                auto updated = replaceSheetReferences(cell.input, oldKey, quotedName);
                if (updated.size() > MaxInputBytes) return -1;
                if (!updated.empty()) changes.emplace_back(&cell, std::move(updated));
            }
        }
    }
    for (auto& [cell, formula] : changes) cell->input = std::move(formula);
    sheetsByName.erase(oldKey);
    target->name = name;
    sheetsByName.emplace(std::move(newKey), target);
    ++revision;
    return 1;
}

EMSCRIPTEN_KEEPALIVE void workbook_reset() {
    sheetsByName.clear();
    sheets.clear();
    nextSheet = 1;
    ++revision;
}

EMSCRIPTEN_KEEPALIVE int workbook_set(int id, int row, int column, int size) {
    auto* sheet = findSheet(id);
    if (!sheet || !validCell(row, column) || size < 0 || size > MaxInputBytes) return 0;
    auto& cells = sheet->columns[column];
    if (size == 0) {
        if (cells.erase(row)) ++revision;
        return 1;
    }
    auto& cell = cells[row];
    cell.input.assign(readInput(size));
    if (cell.input.front() == '=') {
        if (!cell.formula) cell.formula = std::make_unique<FormulaCache>();
    } else {
        cell.formula.reset();
    }
    ++revision;
    return 1;
}

EMSCRIPTEN_KEEPALIVE int workbook_raw(int id, int row, int column) {
    outputBuffer.clear();
    const auto* sheet = findSheet(id);
    if (!sheet || !validCell(row, column)) return 0;
    const auto& cells = sheet->columns[column];
    const auto it = cells.find(row);
    if (it != cells.end()) outputBuffer = it->second.input;
    return outputBuffer.size();
}

EMSCRIPTEN_KEEPALIVE int workbook_value(int id, int row, int column) {
    auto* sheet = findSheet(id);
    if (!sheet || !validCell(row, column)) return 0;
    return publishValue(calculate(*sheet, row, column, 0));
}

EMSCRIPTEN_KEEPALIVE int workbook_next_row(int id, int column, int previousRow) {
    const auto* sheet = findSheet(id);
    if (!sheet || column < 0 || column >= ColumnCount) return -1;
    const auto& cells = sheet->columns[column];
    const auto it = cells.upper_bound(previousRow);
    return it == cells.end() ? -1 : it->first;
}

EMSCRIPTEN_KEEPALIVE int workbook_last_row(int id, int column) {
    const auto* sheet = findSheet(id);
    if (!sheet || column < 0 || column >= ColumnCount) return -1;
    const auto& cells = sheet->columns[column];
    return cells.empty() ? -1 : cells.rbegin()->first;
}

EMSCRIPTEN_KEEPALIVE int workbook_jump_row(int id, int row, int column, int direction) {
    const auto* sheet = findSheet(id);
    if (!sheet || !validCell(row, column)) return row;
    const auto& cells = sheet->columns[column];
    const auto current = cells.lower_bound(row);
    const bool occupied = current != cells.end() && current->first == row;
    if (direction > 0) {
        auto next = occupied ? std::next(current) : current;
        if (next == cells.end()) return RowCount - 1;
        if (occupied && next->first == row + 1) {
            while (next != cells.end() && next->first == row + 1) {
                ++row;
                ++next;
            }
            return row;
        }
        return next->first;
    }
    if (current == cells.begin()) return 0;
    auto previous = std::prev(current);
    if (!occupied || previous->first != row - 1) return previous->first;
    while (previous->first == row - 1) {
        --row;
        if (previous == cells.begin()) break;
        --previous;
    }
    return row;
}

EMSCRIPTEN_KEEPALIVE void workbook_recalculate() { ++revision; }

EMSCRIPTEN_KEEPALIVE void workbook_set_calendar(int date1904, double today) {
    if (calendar1904 != (date1904 != 0) || calendarToday != today) ++revision;
    calendar1904 = date1904 != 0;
    calendarToday = today;
}

EMSCRIPTEN_KEEPALIVE void workbook_clear_sheet(int id) {
    if (auto* sheet = findSheet(id)) {
        for (auto& column : sheet->columns) column.clear();
        ++revision;
    }
}

EMSCRIPTEN_KEEPALIVE int workbook_pivot_start(int id, int top, int bottom, int left, int right,
                                              int columnField, int filterField, int size) {
    auto* sheet = findSheet(id);
    const auto fieldValid = [=](int field) { return field == -1 || (field >= left && field <= right); };
    if (!sheet || !validCell(top, left) || !validCell(bottom, right) || top >= bottom || left > right ||
        !fieldValid(columnField) || !fieldValid(filterField)) return 0;
    pivot = std::make_unique<PivotCalculation>(Range{sheet, top, bottom, left, right},
                                               columnField, filterField, std::string(readInput(size)));
    return 1;
}

EMSCRIPTEN_KEEPALIVE int workbook_pivot_row_field(int column) { return pivot && pivot->addRowField(column); }
EMSCRIPTEN_KEEPALIVE int workbook_pivot_measure(int column, int summary) { return pivot && pivot->addMeasure(column, summary); }
EMSCRIPTEN_KEEPALIVE int workbook_pivot_step(int count) { return pivot ? pivot->step(count) : -1; }
EMSCRIPTEN_KEEPALIVE int workbook_pivot_count(int axis) { return pivot ? pivot->count(axis != 0) : 0; }
EMSCRIPTEN_KEEPALIVE int workbook_pivot_label(int axis, int index, int field) {
    return pivot ? publishValue(pivot->label(axis != 0, index, field)) : 0;
}
EMSCRIPTEN_KEEPALIVE int workbook_pivot_value(int row, int column, int measure) {
    return pivot ? publishValue(pivot->value(row, column, measure)) : 0;
}
EMSCRIPTEN_KEEPALIVE void workbook_pivot_close() { pivot.reset(); }

} // extern "C"

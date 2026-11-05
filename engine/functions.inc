// Scalar functions share argument validation and leave range handling to the parser.

struct Arguments {
    const std::vector<Value>& values;

    Value error(std::size_t minimum, std::size_t maximum) const {
        if (values.size() < minimum || values.size() > maximum) return Value::error("#VALUE!");
        for (const auto& value : values) if (value.failed()) return value;
        return {};
    }

    std::string text(std::size_t index) const {
        return index < values.size() ? values[index].display() : "";
    }

    bool number(std::size_t index, double& output) const {
        return index >= values.size() || asNumber(values[index], output);
    }
};

std::vector<std::size_t> characterOffsets(std::string_view text) {
    std::vector<std::size_t> offsets;
    for (std::size_t index = 0; index < text.size(); ++index) {
        if ((static_cast<unsigned char>(text[index]) & 0xc0) != 0x80) offsets.push_back(index);
    }
    offsets.push_back(text.size());
    return offsets;
}

std::optional<Value> typeFunction(std::string_view name, const std::vector<Value>& args) {
    const auto invalid = Value::error("#VALUE!");
    if (name == "TRUE" || name == "FALSE" || name == "NA") {
        if (!args.empty()) return invalid;
        if (name == "NA") return Value::error("#N/A");
        return Value::boolean(name == "TRUE");
    }
    if (name != "ISBLANK" && name != "ISNUMBER" && name != "ISTEXT" && name != "ISNONTEXT" &&
        name != "ISLOGICAL" && name != "ISERROR" && name != "ISERR" && name != "ISNA" &&
        name != "ISODD" && name != "ISEVEN" && name != "N" && name != "T" &&
        name != "TYPE" && name != "VALUE") return {};
    if (args.size() != 1) return invalid;
    const auto& arg = args.front();
    const auto kind = arg.kind;
    const bool na = arg.failed() && arg.text == "#N/A";
    if (name == "ISBLANK") return Value::boolean(kind == Kind::Blank);
    if (name == "ISNUMBER") return Value::boolean(kind == Kind::Number);
    if (name == "ISTEXT") return Value::boolean(kind == Kind::Text);
    if (name == "ISNONTEXT") return Value::boolean(kind != Kind::Text);
    if (name == "ISLOGICAL") return Value::boolean(kind == Kind::Boolean);
    if (name == "ISERROR") return Value::boolean(arg.failed());
    if (name == "ISERR") return Value::boolean(arg.failed() && !na);
    if (name == "ISNA") return Value::boolean(na);
    if (name == "TYPE") return Value::numeric(kind == Kind::Text ? 2 : kind == Kind::Boolean ? 4 : arg.failed() ? 16 : 1);
    if (arg.failed()) return arg;
    if (name == "N") return Value::numeric(arg.number);
    if (name == "T") return kind == Kind::Text ? arg : Value::string("");
    double number = 0;
    if (name == "VALUE") {
        if (kind == Kind::Number) return arg;
        std::string text(trim(arg.display()));
        const bool percent = !text.empty() && text.back() == '%';
        if (percent) text.pop_back();
        if (!text.empty() && text.front() == '$') text.erase(0, 1);
        text.erase(std::remove(text.begin(), text.end(), ','), text.end());
        return parseNumber(text, number) ? Value::numeric(percent ? number / 100 : number) : invalid;
    }
    if (!asNumber(arg, number)) return invalid;
    return Value::boolean((std::fmod(std::trunc(std::abs(number)), 2) != 0) == (name == "ISODD"));
}

std::optional<Value> textFunction(std::string_view name, const Arguments& args) {
    const bool edges = name == "LEFT" || name == "RIGHT";
    const bool mid = name == "MID";
    const bool replace = name == "REPLACE";
    const bool substitute = name == "SUBSTITUTE";
    const bool find = name == "FIND" || name == "SEARCH";
    const bool before = name == "TEXTBEFORE" || name == "TEXTAFTER";
    const bool repeat = name == "REPT";
    const bool simple = name == "EXACT" || name == "CLEAN" || name == "PROPER" || name == "CHAR";
    if (!edges && !mid && !replace && !substitute && !find && !before && !repeat && !simple) return {};
    const auto minimum = edges || (simple && name != "EXACT") ? 1u : mid || substitute ? 3u : replace ? 4u : 2u;
    const auto maximum = edges ? 2u : (substitute ? 4u : (find || before ? 3u : minimum));
    if (auto error = args.error(minimum, maximum); error.failed()) return error;
    const auto invalid = Value::error("#VALUE!");
    auto text = args.text(0);
    if (name == "EXACT") return Value::boolean(text == args.text(1));
    if (name == "CLEAN") {
        text.erase(std::remove_if(text.begin(), text.end(), [](unsigned char ch) { return ch < 32; }), text.end());
        return Value::string(std::move(text));
    }
    if (name == "PROPER") {
        bool first = true;
        for (auto& ch : text) {
            if (!isLetter(ch)) { first = true; continue; }
            ch = first ? upper(ch) : (ch >= 'A' && ch <= 'Z' ? ch + 'a' - 'A' : ch);
            first = false;
        }
        return Value::string(std::move(text));
    }
    if (name == "CHAR") {
        double code = 0;
        if (!args.number(0, code) || code < 1 || code >= 256) return invalid;
        const auto byte = static_cast<unsigned>(code);
        if (byte < 128) return Value::string(std::string(1, static_cast<char>(byte)));
        constexpr unsigned windows1252[] = {0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021,
            0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c,
            0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178};
        const unsigned cp = byte < 160 ? windows1252[byte - 128] : byte;
        std::string result;
        if (cp >= 2048) result += static_cast<char>(0xe0 | (cp >> 12));
        result += static_cast<char>((cp >= 2048 ? 0x80 : 0xc0) | ((cp >> 6) & 0x3f));
        result += static_cast<char>(0x80 | (cp & 0x3f));
        return Value::string(std::move(result));
    }
    if (find) {
        double start = 1;
        if (!args.number(2, start) || start < 1) return invalid;
        auto haystack = args.text(1);
        if (name == "SEARCH") {
            text = folded(text);
            haystack = folded(haystack);
        }
        const auto offsets = characterOffsets(haystack);
        if (start > offsets.size()) return invalid;
        const auto at = haystack.find(text, offsets[static_cast<std::size_t>(start) - 1]);
        if (at == std::string::npos) return invalid;
        return Value::numeric(std::lower_bound(offsets.begin(), offsets.end(), at) - offsets.begin() + 1);
    }
    if (before || substitute) {
        const auto needle = args.text(1);
        const auto replacement = args.text(2);
        double occurrence = before ? 1 : 0;
        if (!args.number(before ? 2 : 3, occurrence) || std::abs(occurrence) > MaxTextBytes) return invalid;
        const int instance = static_cast<int>(occurrence);
        if (before && !instance) return invalid;
        if (substitute && args.values.size() == 4 && instance < 1) return invalid;
        if (needle.empty()) return before && name == "TEXTBEFORE" ? Value::string("") : Value::string(text);
        std::size_t at = std::string::npos;
        std::size_t from = instance < 0 ? text.size() : 0;
        int found = 0;
        std::string result;
        while (true) {
            at = instance < 0 ? text.rfind(needle, from) : text.find(needle, from);
            if (at == std::string::npos) break;
            ++found;
            if (before && found == std::abs(instance)) {
                return Value::string(name == "TEXTBEFORE" ? text.substr(0, at) : text.substr(at + needle.size()));
            }
            if (substitute) {
                result += text.substr(from, at - from);
                result += (!instance || instance == found) ? replacement : needle;
                if (result.size() > MaxTextBytes) return invalid;
            }
            if (instance < 0 && at == 0) break;
            from = instance < 0 ? at - 1 : at + needle.size();
        }
        if (before) return Value::error("#N/A");
        result += text.substr(from);
        return Value::string(std::move(result));
    }
    double second = 1, third = 0;
    if (!args.number(1, second) || !args.number(2, third) || second < 0 || third < 0) return invalid;
    if (repeat) {
        if (text.empty()) return Value::string("");
        if (second > MaxTextBytes / text.size()) return invalid;
        std::string result;
        result.reserve(static_cast<std::size_t>(second) * text.size());
        for (std::size_t count = 0; count < static_cast<std::size_t>(second); ++count) result += text;
        return Value::string(std::move(result));
    }
    const auto offsets = characterOffsets(text);
    const auto length = offsets.size() - 1;
    const auto bounded = [&](double size) { return static_cast<std::size_t>(std::min(size, static_cast<double>(length))); };
    if (name == "LEFT") return Value::string(text.substr(0, offsets[bounded(second)]));
    if (name == "RIGHT") return Value::string(text.substr(offsets[length - bounded(second)]));
    if (second < 1) return invalid;
    const auto start = bounded(second - 1);
    const auto count = std::min(bounded(third), length - start);
    if (replace) {
        text.replace(offsets[start], offsets[start + count] - offsets[start], args.text(3));
        return Value::string(std::move(text));
    }
    return Value::string(text.substr(offsets[start], offsets[start + count] - offsets[start]));
}

std::optional<Value> mathFunction(std::string_view name, const Arguments& args) {
    using Unary = double (*)(double);
    static constexpr std::pair<std::string_view, Unary> unary[] = {
        {"SIN", std::sin}, {"COS", std::cos}, {"TAN", std::tan}, {"ASIN", std::asin}, {"ACOS", std::acos},
        {"ATAN", std::atan}, {"SINH", std::sinh}, {"COSH", std::cosh}, {"TANH", std::tanh},
        {"ASINH", std::asinh}, {"ACOSH", std::acosh}, {"ATANH", std::atanh}, {"EXP", std::exp},
        {"LN", std::log}, {"LOG10", std::log10}, {"SIGN", [](double n) { return double((n > 0) - (n < 0)); }},
        {"RADIANS", [](double n) { return n * (std::numbers::pi / 180); }},
        {"DEGREES", [](double n) { return n * (180 / std::numbers::pi); }}
    };
    for (const auto& [function, evaluate] : unary) {
        if (name != function) continue;
        if (auto error = args.error(1, 1); error.failed()) return error;
        double number = 0;
        return args.number(0, number) ? Value::numeric(evaluate(number)) : Value::error("#VALUE!");
    }
    const bool optional = name == "LOG" || name == "TRUNC" || name == "CEILING.MATH" || name == "FLOOR.MATH";
    const bool rounding = name == "ROUNDUP" || name == "ROUNDDOWN" || name == "TRUNC";
    const bool power = name == "POWER";
    const bool angle = name == "ATAN2";
    const bool multiple = name == "CEILING" || name == "FLOOR" || name == "CEILING.MATH" ||
        name == "FLOOR.MATH" || name == "MROUND";
    if (!optional && !rounding && !power && !angle && !multiple) return {};
    if (auto error = args.error(optional ? 1 : 2, name.ends_with(".MATH") ? 3 : 2); error.failed()) return error;
    double a = 0, b = name == "LOG" ? 10 : name == "TRUNC" ? 0 : 1, mode = 0;
    const auto invalid = Value::error("#VALUE!");
    if (!args.number(0, a) || !args.number(1, b) || !args.number(2, mode)) return invalid;
    if (power) return applyOperator("^", Value::numeric(a), Value::numeric(b));
    if (angle) return a == 0 && b == 0 ? Value::error("#DIV/0!") : Value::numeric(std::atan2(b, a));
    if (name == "LOG") return Value::numeric(std::log(a) / std::log(b));
    if (rounding) {
        const auto factor = std::pow(10.0, std::clamp(std::trunc(b), -308.0, 308.0));
        const auto scaled = a * factor;
        const auto rounded = name == "ROUNDUP" ? std::copysign(std::ceil(std::abs(scaled)), scaled) : std::trunc(scaled);
        return Value::numeric(std::isfinite(scaled) ? rounded / factor : a);
    }
    if (!b) return Value::numeric(0);
    if (name == "MROUND") {
        if (a && std::signbit(a) != std::signbit(b)) return Value::error("#NUM!");
        return Value::numeric(std::round(a / b) * b);
    }
    const bool ceiling = name.starts_with("CEILING");
    if (name.ends_with(".MATH")) {
        b = std::abs(b);
        return Value::numeric(((a < 0 && mode != 0) != ceiling ? std::ceil(a / b) : std::floor(a / b)) * b);
    }
    if (a > 0 && b < 0) return Value::error("#NUM!");
    return Value::numeric((ceiling ? std::ceil(a / b) : std::floor(a / b)) * b);
}

std::optional<Value> financialFunction(std::string_view name, const Arguments& args) {
    if (name != "PV" && name != "FV" && name != "PMT" && name != "NPER") return {};
    if (auto error = args.error(3, 5); error.failed()) return error;
    double rate = 0, periods = 0, payment = 0, amount = 0, timing = 0;
    if (!args.number(0, rate) || !args.number(1, periods) || !args.number(2, payment) ||
        !args.number(3, amount) || !args.number(4, timing)) return Value::error("#VALUE!");
    if (rate <= -1) return Value::error("#NUM!");
    if (name == "NPER") {
        const double pmt = periods;
        const double present = payment;
        if (!rate) return !pmt ? Value::error("#DIV/0!") : Value::numeric(-(present + amount) / pmt);
        const double annual = pmt * (1 + rate * (timing != 0)) / rate;
        return Value::numeric(std::log((annual - amount) / (present + annual)) / std::log1p(rate));
    }
    const double growth = std::exp(periods * std::log1p(rate));
    const double annuity = (rate ? std::expm1(periods * std::log1p(rate)) / rate : periods) *
                           (1 + rate * (timing != 0));
    if (name == "PV") return Value::numeric(-(payment * annuity + amount) / growth);
    if (name == "FV") return Value::numeric(-payment * annuity - amount * growth);
    return annuity ? Value::numeric(-(payment * growth + amount) / annuity) : Value::error("#DIV/0!");
}

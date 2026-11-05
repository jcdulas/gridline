// Spreadsheet serial dates use a workbook-specific epoch. Serial 60 is reserved for
// the historical 1900 compatibility date, while civil arithmetic is Gregorian.
using namespace std::chrono;

constexpr sys_days DateEpoch1900 = year{1899}/12/31;
constexpr sys_days DateEpoch1904 = year{1904}/1/1;
constexpr sys_days LeapCutover = year{1900}/3/1;
constexpr sys_days LastCalendarDay = year{9999}/12/31;
bool calendar1904 = false;
double calendarToday = 0;

sys_days calendarEpoch() { return calendar1904 ? DateEpoch1904 : DateEpoch1900; }

double spreadsheetSerial(sys_days date) {
    return (date - calendarEpoch()).count() + (!calendar1904 && date >= LeapCutover ? 1 : 0);
}

std::optional<sys_days> fromSerial(double serial) {
    if (!std::isfinite(serial) || serial < 0 || serial > spreadsheetSerial(LastCalendarDay) + 0.99999999) return {};
    const int whole = static_cast<int>(serial);
    return calendarEpoch() + days{whole - (!calendar1904 && whole >= 60 ? 1 : 0)};
}

Value calendarResult(sys_days date) {
    return date < calendarEpoch() || date > LastCalendarDay ? Value::error("#NUM!") : Value::numeric(spreadsheetSerial(date));
}

std::optional<sys_days> isoDate(std::string_view text) {
    if (text.size() != 10 || text[4] != '-' || text[7] != '-') return {};
    const auto integer = [](std::string_view part) {
        int number = 0;
        for (const char ch : part) {
            if (!isDigit(ch)) return -1;
            number = number * 10 + ch - '0';
        }
        return number;
    };
    const year_month_day date = year{integer(text.substr(0, 4))} /
        unsigned(integer(text.substr(5, 2))) / unsigned(integer(text.substr(8)));
    if (!date.ok()) return {};
    return sys_days(date);
}

std::optional<double> clockTime(std::string_view text) {
    auto clock = trim(text);
    const auto suffix = clock.size() >= 2 ? folded(clock.substr(clock.size() - 2)) : std::string{};
    const bool meridiem = suffix == "AM" || suffix == "PM";
    if (meridiem) clock = trim(clock.substr(0, clock.size() - 2));
    std::array<int, 3> parts{};
    int count = 0;
    while (!clock.empty() && count < 3) {
        const auto end = clock.find(':');
        const auto part = clock.substr(0, end);
        if (part.empty() || part.size() > 2 || !std::all_of(part.begin(), part.end(), isDigit)) return {};
        for (const char ch : part) parts[count] = parts[count] * 10 + ch - '0';
        ++count;
        if (end == std::string_view::npos) clock = {};
        else {
            clock.remove_prefix(end + 1);
            if (clock.empty()) return {};
        }
    }
    auto [hour, minute, second] = parts;
    if (!clock.empty() || count < 2 || minute > 59 || second > 59 ||
        (meridiem ? hour < 1 || hour > 12 : hour > 23)) return {};
    if (meridiem) hour = hour % 12 + (suffix == "PM" ? 12 : 0);
    return (hour * 3600 + minute * 60 + second) / 86400.0;
}

std::optional<Value> calendarFunction(std::string_view name, const std::vector<Value>& args) {
    const bool today = name == "TODAY";
    const bool date = name == "DATE";
    const bool time = name == "TIME";
    const bool dateValue = name == "DATEVALUE";
    const bool timeValue = name == "TIMEVALUE";
    const bool datePart = name == "YEAR" || name == "MONTH" || name == "DAY";
    const bool timePart = name == "HOUR" || name == "MINUTE" || name == "SECOND";
    const bool monthOffset = name == "EDATE" || name == "EOMONTH";
    const bool dayCount = name == "DAYS";
    const bool dayOfWeek = name == "WEEKDAY";
    const bool week = name == "ISOWEEKNUM";
    if (!today && !date && !time && !dateValue && !timeValue && !datePart && !timePart &&
        !monthOffset && !dayCount && !dayOfWeek && !week) return {};
    const auto invalid = Value::error("#VALUE!");
    const auto outOfRange = Value::error("#NUM!");
    if (today) return args.empty() ? Value::numeric(calendarToday) : invalid;
    if (dateValue) {
        if (args.size() != 1) return invalid;
        if (args[0].failed()) return args[0];
        const auto parsed = isoDate(trim(args[0].display()));
        return parsed ? calendarResult(*parsed) : invalid;
    }
    if (timeValue) {
        if (args.size() != 1) return invalid;
        if (args[0].failed()) return args[0];
        const auto parsed = clockTime(args[0].display());
        return parsed ? Value::numeric(*parsed) : invalid;
    }
    const std::size_t minimum = date || time ? 3 : monthOffset || dayCount ? 2 : 1;
    if (args.size() < minimum || args.size() > (dayOfWeek ? 2 : minimum)) return invalid;
    std::array<double, 3> numbers = {};
    for (std::size_t index = 0; index < args.size(); ++index) {
        if (args[index].failed()) return args[index];
        if (!asNumber(args[index], numbers[index])) return invalid;
    }
    const auto [first, second, third] = numbers;
    if (time) {
        if (first < 0 || second < 0 || third < 0 || std::max({first, second, third}) > 32767) return outOfRange;
        return Value::numeric(std::fmod(std::trunc(first) * 3600 + std::trunc(second) * 60 + std::trunc(third), 86400) / 86400);
    }
    if (date) {
        if (first < 0 || first > 9999 || std::abs(second) > 120000 || std::abs(third) > 4'000'000) return outOfRange;
        int y = static_cast<int>(first);
        if (y < 1900) y += 1900;
        if (!calendar1904 && y == 1900 && std::trunc(second) == 2 && std::trunc(third) == 29) return Value::numeric(60);
        const auto month = year{y}/January + months{static_cast<int>(second) - 1};
        return calendarResult(sys_days(month/1) + days{static_cast<int>(third) - 1});
    }
    const auto firstDate = fromSerial(first);
    if (!firstDate) return outOfRange;
    const year_month_day ymd(*firstDate);
    if (dayCount) return fromSerial(second) ? Value::numeric(std::floor(first) - std::floor(second)) : outOfRange;
    if (name == "YEAR") return Value::numeric(int(ymd.year()));
    if (name == "MONTH") return Value::numeric(unsigned(ymd.month()));
    if (name == "DAY") return Value::numeric(!calendar1904 && std::floor(first) == 60 ? 29 : unsigned(ymd.day()));
    if (timePart) {
        const int elapsed = static_cast<int>(std::floor((first - std::floor(first)) * 86400 + 1e-6)) % 86400;
        if (name == "HOUR") return Value::numeric(elapsed / 3600);
        if (name == "MINUTE") return Value::numeric((elapsed / 60) % 60);
        return Value::numeric(elapsed % 60);
    }
    if (monthOffset) {
        if (std::abs(second) > 120000) return outOfRange;
        const auto month = ymd.year()/ymd.month() + months{static_cast<int>(second)};
        const auto last = month/std::chrono::last;
        if (name == "EOMONTH") {
            if (!calendar1904 && last.year() == year{1900} && last.month() == February) return Value::numeric(60);
            return calendarResult(sys_days(last));
        }
        return calendarResult(sys_days(month/std::min(ymd.day(), last.day())));
    }
    const auto weekdayIndex = weekday(*firstDate).iso_encoding();
    if (week) {
        const auto thursday = *firstDate + days{4 - static_cast<int>(weekdayIndex)};
        const auto start = sys_days(year_month_day(thursday).year()/January/1);
        return Value::numeric(1 + (thursday - start).count() / 7);
    }
    if (second < 0 || second > 17) return outOfRange;
    const int mode = args.size() == 1 ? 1 : static_cast<int>(second);
    if (mode == 1 || mode == 17) return Value::numeric(weekdayIndex % 7 + 1);
    if (mode == 2 || mode == 11) return Value::numeric(weekdayIndex);
    if (mode == 3) return Value::numeric(weekdayIndex - 1);
    if (mode >= 12 && mode <= 16) return Value::numeric((static_cast<int>(weekdayIndex) - (mode - 10) + 7) % 7 + 1);
    return outOfRange;
}

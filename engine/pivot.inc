// This file is included inside the workbook namespace and uses its sparse cells.

enum class PivotSummary { Sum, Count, Average, Min, Max, CountNumbers };

struct PivotMeasure {
    int column;
    PivotSummary summary;
};

struct PivotStatistic {
    std::int64_t nonblank = 0;
    std::int64_t numbers = 0;
    double sum = 0;
    double minimum = 0;
    double maximum = 0;
    Value error;

    void add(const Value& value) {
        if (value.kind == Kind::Blank) return;
        ++nonblank;
        if (value.failed() && !error.failed()) error = value;
        if (value.kind != Kind::Number) return;
        if (numbers == 0) minimum = maximum = value.number;
        else {
            minimum = std::min(minimum, value.number);
            maximum = std::max(maximum, value.number);
        }
        ++numbers;
        sum += value.number;
    }

    Value summarize(PivotSummary summary) const {
        if (summary == PivotSummary::Count) return Value::numeric(nonblank);
        if (summary == PivotSummary::CountNumbers) return Value::numeric(numbers);
        if (error.failed()) return error;
        if (summary == PivotSummary::Sum) return Value::numeric(sum);
        if (!numbers) return {};
        if (summary == PivotSummary::Average) return Value::numeric(sum / numbers);
        return Value::numeric(summary == PivotSummary::Min ? minimum : maximum);
    }
};

struct PivotKey {
    std::vector<Value> labels;
    std::vector<std::tuple<Kind, double, std::string>> order;

    void add(Value value) {
        order.emplace_back(value.kind, value.number, folded(value.text));
        labels.push_back(std::move(value));
    }

    bool operator<(const PivotKey& other) const { return order < other.order; }
};

using PivotTotals = std::array<PivotStatistic, 3>;

struct PivotGroup {
    PivotTotals total;
    std::map<PivotKey, PivotTotals> columns;
};

class PivotCalculation {
public:
    PivotCalculation(Range source, int columnField, int filterField, std::string filter)
        : source_(source), columnField_(columnField), filterField_(filterField), filter_(folded(filter)) {
        for (int column = source_.firstColumn; column <= source_.lastColumn; ++column) {
            auto& cells = source_.sheet->columns[column];
            cursors_[column] = cells.upper_bound(source_.firstRow);
            addNext(column);
        }
    }

    bool addRowField(int column) {
        if (!validColumn(column) || rowFields_.size() == 2 || started_) return false;
        rowFields_.push_back(column);
        return true;
    }

    bool addMeasure(int column, int summary) {
        if (!validColumn(column) || measures_.size() == 3 || started_ || summary < 0 || summary > 5) return false;
        measures_.push_back({column, static_cast<PivotSummary>(summary)});
        return true;
    }

    int step(int limit) {
        if (rowFields_.empty() || measures_.empty()) return -1;
        if (finished_) return 0;
        started_ = true;
        for (int index = 0; index < limit && !queue_.empty(); ++index) {
            const int row = queue_.top().first;
            do {
                const int column = queue_.top().second;
                queue_.pop();
                ++cursors_[column];
                addNext(column);
            } while (!queue_.empty() && queue_.top().first == row);
            addRecord(row);
            const auto width = rowFields_.size() + (columnField_ < 0 ? 1 : columns_.size() + 1) * measures_.size();
            if (width > ColumnCount || (rows_.size() + 2) * width > 100'000) return -2;
        }
        if (!queue_.empty()) return 1;
        for (const auto& row : rows_) sortedRows_.push_back(&row);
        for (const auto& column : columns_) sortedColumns_.push_back(&column);
        finished_ = true;
        return 0;
    }

    int count(bool column) const {
        return static_cast<int>(column ? sortedColumns_.size() : sortedRows_.size());
    }

    Value label(bool column, int index, int field) const {
        if (index < 0 || index >= count(column) || field < 0) return {};
        const auto& key = column ? sortedColumns_[index]->first : sortedRows_[index]->first;
        return field < static_cast<int>(key.labels.size()) ? key.labels[field] : Value{};
    }

    Value value(int row, int column, int measure) const {
        if (!finished_ || row < -1 || column < -1 || row >= count(false) || column >= count(true) ||
            measure < 0 || measure >= static_cast<int>(measures_.size())) return {};
        const auto summary = measures_[measure].summary;
        if (row == -1 && column == -1) return total_[measure].summarize(summary);
        if (row == -1) return sortedColumns_[column]->second[measure].summarize(summary);
        const auto& group = sortedRows_[row]->second;
        if (column == -1) return group.total[measure].summarize(summary);
        const auto found = group.columns.find(sortedColumns_[column]->first);
        return found == group.columns.end() ? Value{} : found->second[measure].summarize(summary);
    }

private:
    bool validColumn(int column) const { return column >= source_.firstColumn && column <= source_.lastColumn; }

    void addNext(int column) {
        const auto it = cursors_[column];
        if (it != source_.sheet->columns[column].end() && it->first <= source_.lastRow) queue_.emplace(it->first, column);
    }

    void addRecord(int row) {
        const auto read = [&](int column) { return calculate(*source_.sheet, row, column, 0); };
        if (filterField_ >= 0 && folded(read(filterField_).display()) != filter_) return;
        PivotKey rowKey;
        for (const int column : rowFields_) rowKey.add(read(column));
        auto& group = rows_[std::move(rowKey)];
        PivotTotals* columnTotal = nullptr;
        PivotTotals* intersection = nullptr;
        if (columnField_ >= 0) {
            PivotKey key;
            key.add(read(columnField_));
            columnTotal = &columns_[key];
            intersection = &group.columns[std::move(key)];
        }
        for (std::size_t index = 0; index < measures_.size(); ++index) {
            const auto value = read(measures_[index].column);
            total_[index].add(value);
            group.total[index].add(value);
            if (columnTotal) (*columnTotal)[index].add(value);
            if (intersection) (*intersection)[index].add(value);
        }
    }

    Range source_;
    int columnField_;
    int filterField_;
    std::string filter_;
    bool started_ = false;
    bool finished_ = false;
    std::vector<int> rowFields_;
    std::vector<PivotMeasure> measures_;
    std::array<std::map<int, Cell>::iterator, ColumnCount> cursors_;
    using Coordinate = std::pair<int, int>;
    std::priority_queue<Coordinate, std::vector<Coordinate>, std::greater<Coordinate>> queue_;
    std::map<PivotKey, PivotGroup> rows_;
    std::map<PivotKey, PivotTotals> columns_;
    PivotTotals total_;
    std::vector<const decltype(rows_)::value_type*> sortedRows_;
    std::vector<const decltype(columns_)::value_type*> sortedColumns_;
};

std::unique_ptr<PivotCalculation> pivot;

int publishValue(const Value& value) {
    resultNumber = value.number;
    outputBuffer = value.display();
    return static_cast<int>(value.kind);
}

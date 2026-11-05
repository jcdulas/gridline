const functionExamples = [
  ["SUM", "SUM(A1:A10)", "Add numbers in a range."],
  ["AVERAGE", "AVERAGE(A1:A10)", "Calculate the arithmetic mean."],
  ["COUNT", "COUNT(A1:A10)", "Count numeric values."],
  ["COUNTA", "COUNTA(A1:A10)", "Count cells with a value."],
  ["MIN", "MIN(A1:A10)", "Return the smallest number."],
  ["MAX", "MAX(A1:A10)", "Return the largest number."],
  ["PRODUCT", "PRODUCT(A1:A10)", "Multiply numbers in a range."],
  ["SUMIF", 'SUMIF(A1:A10,">0",B1:B10)', "Sum values where a criterion matches."],
  ["COUNTIF", 'COUNTIF(A1:A10,">0")', "Count cells matching a criterion."],
  ["AVERAGEIF", 'AVERAGEIF(A1:A10,">0",B1:B10)', "Average values where a criterion matches."],
  ["IF", 'IF(A1>0,"Yes","No")', "Choose a result based on a condition."],
  ["IFERROR", "IFERROR(A1/B1,0)", "Choose a fallback if a calculation fails."],
  ["AND", "AND(A1>0,B1>0)", "Check whether all conditions are true."],
  ["OR", "OR(A1>0,B1>0)", "Check whether any condition is true."],
  ["NOT", "NOT(A1)", "Reverse a logical value."],
  ["ROUND", "ROUND(A1,2)", "Round a number to a specified precision."],
  ["INT", "INT(A1)", "Round a number down to an integer."],
  ["MOD", "MOD(A1,2)", "Return the remainder of division."],
  ["ABS", "ABS(A1)", "Return the absolute value."],
  ["SQRT", "SQRT(A1)", "Return the square root."],
  ["PI", "PI()", "Return the constant π."],
  ["CONCAT", "CONCAT(A1,B1)", "Join values as text."],
  ["LEN", "LEN(A1)", "Count characters in text."],
  ["UPPER", "UPPER(A1)", "Convert English letters to uppercase."],
  ["LOWER", "LOWER(A1)", "Convert English letters to lowercase."],
  ["TRIM", "TRIM(A1)", "Remove leading, trailing, and repeated spaces."],
  ["VLOOKUP", "VLOOKUP(A1,B2:D20,3,FALSE)", "Find a value in the first column of a range."],
  ["XLOOKUP", 'XLOOKUP(A1,B2:B20,C2:C20,"Missing")', "Find a value and return the corresponding result."],
  ["INDEX", "INDEX(A1:C10,2,3)", "Return a value at a row and column in a range."],
  ["MATCH", "MATCH(A1,B2:B20,0)", "Return the position of a matching value."]
];

const additionalExamples = {
  DATE: "DATE(2024,2,29)", TODAY: "TODAY()", DATEVALUE: 'DATEVALUE("2024-02-29")',
  TIME: "TIME(14,30,0)", TIMEVALUE: 'TIMEVALUE("2:30 PM")', YEAR: "YEAR(A1)", MONTH: "MONTH(A1)", DAY: "DAY(A1)",
  HOUR: "HOUR(A1)", MINUTE: "MINUTE(A1)", SECOND: "SECOND(A1)", EDATE: "EDATE(A1,1)", EOMONTH: "EOMONTH(A1,1)",
  DAYS: "DAYS(A2,A1)", WEEKDAY: "WEEKDAY(A1,2)", ISOWEEKNUM: "ISOWEEKNUM(A1)",
  SUMIFS: 'SUMIFS(B2:B20,A2:A20,">0")', COUNTIFS: 'COUNTIFS(A2:A20,">0",B2:B20,"North")',
  AVERAGEIFS: 'AVERAGEIFS(B2:B20,A2:A20,">0")', MINIFS: 'MINIFS(B2:B20,A2:A20,">0")',
  MAXIFS: 'MAXIFS(B2:B20,A2:A20,">0")', COUNTBLANK: "COUNTBLANK(A1:A10)",
  MEDIAN: "MEDIAN(A1:A10)", LARGE: "LARGE(A1:A10,2)", SMALL: "SMALL(A1:A10,2)",
  "STDEV.S": "STDEV.S(A1:A10)", "STDEV.P": "STDEV.P(A1:A10)", STDEV: "STDEV(A1:A10)", STDEVP: "STDEVP(A1:A10)",
  "VAR.S": "VAR.S(A1:A10)", "VAR.P": "VAR.P(A1:A10)", VAR: "VAR(A1:A10)", VARP: "VARP(A1:A10)",
  SUMSQ: "SUMSQ(A1:A10)", SUMPRODUCT: "SUMPRODUCT(A1:A10,B1:B10)",
  TEXTJOIN: 'TEXTJOIN(", ",TRUE,A1:A10)', LEFT: "LEFT(A1,3)", RIGHT: "RIGHT(A1,3)",
  MID: "MID(A1,2,3)", REPLACE: 'REPLACE(A1,2,3,"new")', SUBSTITUTE: 'SUBSTITUTE(A1,"old","new")',
  FIND: 'FIND("abc",A1)', SEARCH: 'SEARCH("abc",A1)', TEXTBEFORE: 'TEXTBEFORE(A1,"-")',
  TEXTAFTER: 'TEXTAFTER(A1,"-")', REPT: 'REPT("*",5)', EXACT: "EXACT(A1,B1)", CLEAN: "CLEAN(A1)",
  PROPER: "PROPER(A1)", CHAR: "CHAR(65)", TRUE: "TRUE()", FALSE: "FALSE()", NA: "NA()", IFNA: "IFNA(A1,0)",
  ISBLANK: "ISBLANK(A1)", ISNUMBER: "ISNUMBER(A1)", ISTEXT: "ISTEXT(A1)", ISNONTEXT: "ISNONTEXT(A1)",
  ISLOGICAL: "ISLOGICAL(A1)", ISERROR: "ISERROR(A1)", ISERR: "ISERR(A1)", ISNA: "ISNA(A1)", ISODD: "ISODD(A1)",
  ISEVEN: "ISEVEN(A1)", N: "N(A1)", T: "T(A1)", TYPE: "TYPE(A1)", VALUE: 'VALUE("1,250.50")',
  ROUNDUP: "ROUNDUP(A1,2)", ROUNDDOWN: "ROUNDDOWN(A1,2)", TRUNC: "TRUNC(A1,2)", POWER: "POWER(A1,2)",
  LOG: "LOG(A1,2)", LOG10: "LOG10(A1)", LN: "LN(A1)", EXP: "EXP(A1)", SIGN: "SIGN(A1)",
  SIN: "SIN(A1)", COS: "COS(A1)", TAN: "TAN(A1)", ASIN: "ASIN(A1)", ACOS: "ACOS(A1)", ATAN: "ATAN(A1)",
  SINH: "SINH(A1)", COSH: "COSH(A1)", TANH: "TANH(A1)", ASINH: "ASINH(A1)", ACOSH: "ACOSH(A1)", ATANH: "ATANH(A1)",
  ATAN2: "ATAN2(A1,B1)", DEGREES: "DEGREES(A1)", RADIANS: "RADIANS(A1)",
  CEILING: "CEILING(A1,5)", FLOOR: "FLOOR(A1,5)", "CEILING.MATH": "CEILING.MATH(A1,5)",
  "FLOOR.MATH": "FLOOR.MATH(A1,5)", MROUND: "MROUND(A1,5)", PV: "PV(5%,12,-100)",
  FV: "FV(5%,12,-100)", PMT: "PMT(5%,12,1000)", NPER: "NPER(5%,-100,1000)", NPV: "NPV(5%,A1:A10)",
  ROWS: "ROWS(A1:A10)", COLUMNS: "COLUMNS(A1:D1)", CHOOSE: 'CHOOSE(2,"One","Two")'
};
for (const [name, example] of Object.entries(additionalExamples)) functionExamples.push([name, example, ""]);

function cellCount(bounds) {
  return (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);
}

function* rectangle(bounds) {
  for (let row = bounds.top; row <= bounds.bottom; row++) {
    for (let column = bounds.left; column <= bounds.right; column++) yield { row, column };
  }
}

function parseClipboard(text, columns, maxSize) {
  const matrix = [];
  const reader = new DelimitedReader("\t", (fields) => {
    matrix.push(fields);
    if (matrix.length > 100_000) throw new Error("Paste up to 100,000 cells at a time, or use CSV import.");
  }, columns, maxSize);
  reader.feed(text);
  reader.finish();
  return matrix;
}

function shiftFormula(input, rowDelta, columnDelta, engine) {
  if (!input.startsWith("=") || (!rowDelta && !columnDelta)) return input;
  // Quoted literals and sheet qualifiers are consumed before any cell reference.
  const tokens = /"(?:[^"]|"")*"|'(?:[^']|'')*'!|[a-z_][a-z0-9_.]*!|\$?[a-z]{1,3}\s*:\s*\$?[a-z]{1,3}(?![a-z\d_.$])|\$?[a-z]+\$?\d+(?![a-z\d_.])|[a-z_][a-z\d_.]*|\d+(?:\.\d*)?(?:e[+-]?\d+)?/gi;
  return input.replace(tokens, (token, position) => {
    if (/["'!]/.test(token) || /^\s*\(/.test(input.slice(position + token.length))) return token;
    if (token.includes(":")) {
      return token.replace(/\$?[a-z]+/gi, (reference) => {
        const address = parseAddress(reference + "1", engine.rows, engine.columns);
        if (!address || reference.startsWith("$")) return reference;
        const column = address.column + columnDelta;
        return column >= 0 && column < engine.columns ? columnName(column) : "#REF!";
      });
    }
    const match = /^(\$?)([a-z]+)(\$?)(\d+)$/i.exec(token);
    if (!match) return token;
    const address = parseAddress(token, engine.rows, engine.columns);
    if (!address) return token;
    const row = address.row + (match[3] ? 0 : rowDelta);
    const column = address.column + (match[1] ? 0 : columnDelta);
    if (row < 0 || column < 0 || row >= engine.rows || column >= engine.columns) return "#REF!";
    return match[1] + columnName(column) + match[3] + (row + 1);
  });
}

function compareValues(left, right) {
  if (left.kind === ValueKind.number && right.kind === ValueKind.number) return left.number - right.number;
  if (left.kind === right.kind) return left.text.localeCompare(right.text, "en-US", { sensitivity: "base", numeric: true });
  if (left.kind === ValueKind.blank) return 1;
  if (right.kind === ValueKind.blank) return -1;
  return left.kind - right.kind;
}

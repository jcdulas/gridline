const dayMillis = 86_400_000;
const serialDateEpoch = Date.UTC(1899, 11, 31);
const serialDate1904Epoch = Date.UTC(1904, 0, 1);
const serialDateLeapCutover = Date.UTC(1900, 2, 1);
const dateFormats = {
  date: "yyyy-mm-dd", "date-us": "mm/dd/yyyy", "date-eu": "dd/mm/yyyy",
  "date-long": "d mmm yyyy", datetime: "yyyy-mm-dd hh:mm:ss", time: "hh:mm:ss"
};
const englishMonths = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const englishDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function serialDate(milliseconds, date1904) {
  if (date1904) return (milliseconds - serialDate1904Epoch) / dayMillis;
  return (milliseconds - serialDateEpoch) / dayMillis + (milliseconds >= serialDateLeapCutover ? 1 : 0);
}

function serialMillis(serial, date1904) {
  return (date1904 ? serialDate1904Epoch : serialDateEpoch) +
    Math.round((serial - (!date1904 && serial >= 60 ? 1 : 0)) * dayMillis);
}

function localToday() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function readCalendarDate(text, preferDayFirst = false) {
  const match = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/.](\d{1,2})[/.](\d{4}))(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (!match) return null;
  const [, isoYear, isoMonth, isoDay, first, second, slashYear, hours = 0, minutes = 0, seconds = 0] = match;
  const year = Number(isoYear || slashYear);
  const dayFirst = preferDayFirst || Number(first) > 12;
  const month = Number(isoMonth || (dayFirst ? second : first));
  const day = Number(isoDay || (dayFirst ? first : second));
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31 ||
      Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null;
  const time = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { time, format: match[7] ? "datetime" : "date" };
}

function calendarInput(text, style, engine) {
  const parsed = readCalendarDate(text, style?.format === "date-eu" || /^d/i.test(style?.xlsxFormat || ""));
  if (!parsed) return { text, style };
  const value = serialDate(parsed.time, engine.date1904);
  if (value < 0) return { text, style };
  const existing = dateFormats[style?.format] && style.format !== "time";
  return {
    text: String(value),
    style: { ...style, format: existing ? style.format : parsed.format,
      xlsxFormat: existing ? style.xlsxFormat : undefined, date1904: engine.date1904 || undefined }
  };
}

function calendarDisplay(serial, style) {
  if (serial < 0 || serial > 2_958_465) return null;
  const phantom = !style.date1904 && Math.floor(serial) === 60;
  const date = new Date(serialMillis(serial, style.date1904));
  if (date.getUTCFullYear() > 9999) return null;
  const format = (style.xlsxFormat || dateFormats[style.format]).split(";")[0];
  const tokens = format.match(/"[^"]*"|\\.|\[[hms]+\]|am\/pm|a\/p|y+|m+|d+|h+|s+|./gi) || [];
  const hour = date.getUTCHours();
  const isAmPm = tokens.some((token) => /^(am\/pm|a\/p)$/i.test(token));
  const pad = (number, places) => String(number).padStart(places, "0");
  return tokens.map((part, index) => {
    const token = part.toLowerCase();
    if (part.startsWith('"')) return part.slice(1, -1);
    if (part.startsWith("\\")) return part.slice(1);
    if (token === "am/pm") return hour < 12 ? "AM" : "PM";
    if (token === "a/p") return hour < 12 ? "A" : "P";
    if (/^\[[hms]+\]$/.test(token)) {
      const unit = { h: 24, m: 1440, s: 86400 }[token[1]];
      return pad(Math.floor(serial * unit + 1e-8), token.length - 2);
    }
    if (/^y+$/.test(token)) {
      const year = date.getUTCFullYear();
      return token.length <= 2 ? pad(year % 100, 2) : pad(year, 4);
    }
    if (/^d+$/.test(token)) {
      const day = phantom ? 29 : date.getUTCDate();
      const name = englishDays[date.getUTCDay()];
      return token.length >= 4 ? name : token.length === 3 ? name.slice(0, 3) : pad(day, token.length);
    }
    if (/^m+$/.test(token)) {
      const before = tokens.slice(0, index).reverse().find((item) => /^[ymdhs\[]/i.test(item));
      const after = tokens.slice(index + 1).find((item) => /^[ymdhs\[]/i.test(item));
      if (token.length <= 2 && (/^\[?h/i.test(before || "") || /^\[?s/i.test(after || "") || style.format === "time")) {
        return pad(date.getUTCMinutes(), token.length);
      }
      const name = englishMonths[date.getUTCMonth()];
      if (token.length >= 5) return name[0];
      return token.length === 4 ? name : token.length === 3 ? name.slice(0, 3) : pad(date.getUTCMonth() + 1, token.length);
    }
    if (/^h+$/.test(token)) return pad(isAmPm ? (hour % 12 || 12) : hour, token.length);
    if (/^s+$/.test(token)) return pad(date.getUTCSeconds(), token.length);
    return part;
  }).join("");
}

function seriesPattern(samples, engine) {
  if (samples.some(({ raw }) => !raw || raw.startsWith("="))) return null;
  const numbers = samples.every(({ value }) => value.kind === ValueKind.number);
  if (numbers && samples.every(({ style }) => style?.format !== "time" && Boolean(dateFormats[style?.format]))) {
    const times = samples.map(({ value }) => serialMillis(value.number, engine.date1904));
    if (!engine.date1904 && samples.some(({ value }) => Math.floor(value.number) === 60)) return null;
    const first = new Date(times[0]);
    const monthIndex = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
    const monthStep = times.length > 1 ? monthIndex(new Date(times[1])) - monthIndex(first) : 0;
    const endOfMonth = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const endSeries = times.every((time) => {
      const date = new Date(time);
      return date.getUTCDate() === endOfMonth(date);
    });
    const timeOfDay = ((times[0] % dayMillis) + dayMillis) % dayMillis;
    const monthAt = (index) => {
      const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + monthStep * index, 1));
      const last = endOfMonth(date);
      const day = endSeries ? last : Math.min(first.getUTCDate(), last);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day) + timeOfDay;
    };
    const dayStep = times.length > 1 ? times[1] - times[0] : dayMillis;
    const dateAt = monthStep && times.every((time, index) => monthAt(index) === time) ? monthAt
      : times.every((time, index) => Math.abs(times[0] + dayStep * index - time) <= 1)
        ? (index) => times[0] + dayStep * index : null;
    if (!dateAt) return null;
    return (index) => {
      const time = dateAt(index);
      const value = serialDate(time, engine.date1904);
      if (!Number.isFinite(value) || value < 0 || new Date(time).getUTCFullYear() > 9999) {
        throw new Error("The date series would extend outside the workbook calendar.");
      }
      return String(value);
    };
  }
  if (numbers && samples.length >= 2) {
    const start = samples[0].value.number;
    const step = samples[1].value.number - start;
    if (Number.isFinite(step) && samples.every(({ value }, index) =>
      Math.abs(start + index * step - value.number) <= 1e-12 * Math.max(1, Math.abs(value.number)))) {
      return (index) => {
        const value = start + step * index;
        if (!Number.isFinite(value)) throw new Error("The number series exceeds the supported range.");
        return String(Number(value.toPrecision(15)));
      };
    }
  }
  for (const names of [englishDays, englishMonths, englishDays.map((name) => name.slice(0, 3)),
    englishMonths.map((name) => name.slice(0, 3))]) {
    const positions = samples.map(({ value }) => value.kind === ValueKind.text
      ? names.findIndex((name) => name.toLowerCase() === value.text.toLowerCase()) : -1);
    if (positions.includes(-1)) continue;
    const length = names.length;
    const wrap = (index) => ((index % length) + length) % length;
    const step = positions.length > 1 ? wrap(positions[1] - positions[0]) : 1;
    if (!positions.every((position, index) => position === wrap(positions[0] + step * index))) continue;
    const initial = samples[0].value.text;
    return (index) => {
      const name = names[wrap(positions[0] + step * index)];
      return initial === initial.toUpperCase() ? name.toUpperCase()
        : initial === initial.toLowerCase() ? name.toLowerCase() : name;
    };
  }
  return null;
}

function buildSample(engine) {
  const sales = newSheetModel(engine.addSheet("Sales overview"), "Sales overview");
  const assumptions = newSheetModel(engine.addSheet("Assumptions"), "Assumptions");
  const set = (sheet, address, text, style) => {
    const { row, column } = parseAddress(address, engine.rows, engine.columns);
    engine.set(sheet.id, row, column, text);
    if (style) sheet.styles.set(cellKey(row, column, engine.columns), style);
  };
  const heading = { bold: true, size: 28, color: "#15394d" };
  const note = { color: "#566d80", size: 12 };
  const label = { bold: true, size: 11, color: "#3e6870" };
  const metric = { bold: true, size: 20, color: "#11613d", fill: "#eaf5ee", format: "currency", decimals: 0, align: "center" };
  const tableHeader = { bold: true, color: "#ffffff", fill: "#24614e", size: 12 };

  [34, 140, 113, 136, 84, 124, 84, 134, 117, 119, 134].forEach((width, column) => sales.widths.set(column, width));
  sales.heights.set(1, 43);
  sales.heights.set(4, 23);
  sales.heights.set(5, 36);
  sales.heights.set(7, 28);
  set(sales, "B2", "Quarterly sales tracker", heading);
  set(sales, "B3", "Q3 2025  /  Commercial operations  /  USD", note);
  set(sales, "B5", "TOTAL REVENUE", label);
  set(sales, "D5", "GROSS PROFIT", label);
  set(sales, "F5", "AVG. MARGIN", label);
  set(sales, "H5", "UNITS SOLD", label);
  set(sales, "B6", "=SUM(H9:H24)", metric);
  set(sales, "D6", "=SUM(J9:J24)", metric);
  set(sales, "F6", "=IFERROR(D6/B6,0)", { ...metric, format: "percent", decimals: 1 });
  set(sales, "H6", "=SUM(E9:E24)", { ...metric, format: "integer" });

  const headers = ["Region", "Channel", "Product", "Units", "Unit price", "Discount", "Revenue", "Cost", "Gross profit", "Target"];
  for (const [index, header] of headers.entries()) set(sales, cellName(7, index + 1), header, tableHeader);

  const orders = [
    ["North America", "Direct", "Studio Desk", 124, 420, .05, 30400],
    ["Europe", "Partner", "Focus Chair", 186, 285, .08, 29500],
    ["Asia Pacific", "Online", "Task Lamp", 345, 78, .04, 15100],
    ["North America", "Online", "Monitor Arm", 217, 125, .03, 15950],
    ["Europe", "Direct", "Studio Desk", 106, 420, .06, 26100],
    ["Latin America", "Partner", "Focus Chair", 98, 285, .10, 15300],
    ["Asia Pacific", "Direct", "Focus Chair", 142, 285, .05, 21650],
    ["Europe", "Online", "Task Lamp", 281, 78, .03, 12080],
    ["North America", "Partner", "Monitor Arm", 167, 125, .09, 11500],
    ["Latin America", "Online", "Task Lamp", 204, 78, .04, 8840],
    ["Asia Pacific", "Partner", "Studio Desk", 119, 420, .08, 29150],
    ["Europe", "Direct", "Monitor Arm", 156, 125, .04, 10920],
    ["North America", "Direct", "Focus Chair", 224, 285, .05, 35100],
    ["Asia Pacific", "Online", "Monitor Arm", 179, 125, .03, 13060],
    ["Latin America", "Direct", "Studio Desk", 76, 420, .07, 18340],
    ["Europe", "Partner", "Task Lamp", 266, 78, .09, 11100]
  ];
  for (const [index, order] of orders.entries()) {
    const row = index + 9;
    const [region, channel, product, units, price, discount, cost] = order;
    const values = [region, channel, product, units, price, discount,
      `=ROUND(E${row}*F${row}*(1-G${row}),2)`, cost, `=H${row}-I${row}`,
      `=IF(IFERROR(J${row}/H${row},0)>=Assumptions!$C$5,"On track","Review")`];
    for (const [index, value] of values.entries()) {
      const style = {};
      if (row % 2 === 0) style.fill = "#f4f8fa";
      if (index === 3) style.format = "integer";
      if ([4, 6, 7, 8].includes(index)) style.format = "currency";
      if (index === 5) style.format = "percent";
      if (index === 6 || index === 8) style.color = "#10613d";
      set(sales, columnName(index + 1) + row, String(value), style);
    }
  }
  const totalStyle = { bold: true, fill: "#e5f2eb", color: "#145639" };
  for (let column = 1; column <= 10; column++) {
    const name = columnName(column);
    const text = column === 1 ? "Total" : [4, 7, 8, 9].includes(column) ? `=SUM(${name}9:${name}24)` : "";
    const style = column >= 7 ? { ...totalStyle, format: "currency" } : totalStyle;
    set(sales, name + "25", text, style);
  }
  const selected = { row: 8, column: 7 };
  sales.selection = { anchor: selected, end: selected };

  [34, 184, 125, 144, 120].forEach((width, column) => assumptions.widths.set(column, width));
  assumptions.heights.set(1, 43);
  set(assumptions, "B2", "Workbook assumptions", heading);
  set(assumptions, "B3", "Change the target to update the Sales overview worksheet.", note);
  set(assumptions, "B4", "Metric", tableHeader);
  set(assumptions, "C4", "Value", tableHeader);
  set(assumptions, "B5", "Gross margin target", { bold: true, fill: "#f4f8fa" });
  set(assumptions, "C5", "0.38", { format: "percent", fill: "#eaf5ee", color: "#11613d" });
  return [sales, assumptions];
}

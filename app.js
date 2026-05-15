const COLUMNS = [
  { key: "thousands", exponent: 3, word: "thousands", fraction: "1000" },
  { key: "hundreds", exponent: 2, word: "hundreds", fraction: "100" },
  { key: "tens", exponent: 1, word: "tens", fraction: "10" },
  { key: "ones", exponent: 0, word: "ones", fraction: "1" },
  { key: "tenths", exponent: -1, word: "tenths", fraction: "\\frac{1}{10}" },
  { key: "hundredths", exponent: -2, word: "hundredths", fraction: "\\frac{1}{100}" },
  { key: "thousandths", exponent: -3, word: "thousandths", fraction: "\\frac{1}{1000}" },
];

const svg = d3.select("#placeValueSvg");
const controls = document.querySelector("#controls");
const replayButton = document.querySelector("#replayButton");
const numberInput = document.querySelector("#numberInput");
const powerSelect = document.querySelector("#powerSelect");
const zeroFillInput = document.querySelector("#zeroFill");
const inputError = document.querySelector("#inputError");
const calculationText = document.querySelector("#calculationText");
const beforeNumber = document.querySelector("#beforeNumber");
const afterNumber = document.querySelector("#afterNumber");
const movementText = document.querySelector("#movementText");

const layout = {
  width: 1120,
  height: 540,
  marginLeft: 142,
  marginTop: 28,
  columnWidth: 132,
  headerHeight: 112,
  rowHeight: 142,
  rowGap: 18,
  tokenSize: 56,
};

const formatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 12,
  useGrouping: false,
});

let renderVersion = 0;

function getSettings() {
  return {
    rawNumber: numberInput.value.trim(),
    operation: new FormData(controls).get("operation"),
    power: Number(powerSelect.value),
    headerStyle: new FormData(controls).get("headerStyle"),
    zeroFill: zeroFillInput.checked,
  };
}

function parseNumber(value) {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    throw new Error("Enter a decimal number using digits and at most one decimal point.");
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("Enter a number that can be shown on this place value chart.");
  }

  const [integerPartRaw, decimalPartRaw = ""] = value.split(".");
  const integerPart = (integerPartRaw || "0").replace(/^0+(?=\d)/, "");
  const decimalPart = decimalPartRaw;
  const highestExponent = integerPart === "0" ? -1 : integerPart.length - 1;
  const lowestExponent = decimalPart.length ? -decimalPart.length : 0;

  if (highestExponent > 3 || lowestExponent < -3) {
    throw new Error("Use a number from thousands to thousandths for this chart.");
  }

  return { number, integerPart, decimalPart };
}

function digitMap(parsed) {
  const map = new Map();
  const integerDigits = parsed.integerPart.padStart(1, "0").split("");
  const startExponent = integerDigits.length - 1;

  integerDigits.forEach((digit, index) => {
    const exponent = startExponent - index;
    if (exponent >= -3 && exponent <= 3) {
      map.set(exponent, digit);
    }
  });

  parsed.decimalPart.split("").forEach((digit, index) => {
    const exponent = -(index + 1);
    if (exponent >= -3 && exponent <= 3) {
      map.set(exponent, digit);
    }
  });

  if (!map.size) {
    map.set(0, "0");
  }

  return map;
}

function shiftedDigitMap(sourceMap, operation, power) {
  const direction = operation === "multiply" ? 1 : -1;
  const result = new Map();
  sourceMap.forEach((digit, exponent) => {
    const nextExponent = exponent + direction * power;
    result.set(nextExponent, digit);
  });
  return result;
}

function calculateValue(value, operation, power) {
  const factor = 10 ** power;
  const result = operation === "multiply" ? value * factor : value / factor;
  return Number(result.toPrecision(14));
}

function formatValue(value) {
  if (Object.is(value, -0)) return "0";
  return formatter.format(value);
}

function operatorSymbol(operation) {
  return operation === "multiply" ? "x" : "÷";
}

function xForExponent(exponent) {
  const index = COLUMNS.findIndex((column) => column.exponent === exponent);
  return layout.marginLeft + index * layout.columnWidth + layout.columnWidth / 2;
}

function rowY(rowIndex) {
  return layout.marginTop + layout.headerHeight + rowIndex * (layout.rowHeight + layout.rowGap);
}

function tokenY(rowIndex) {
  return rowY(rowIndex) + layout.rowHeight / 2;
}

function renderHeaders(headerStyle) {
  const headers = svg.select(".headers").selectAll("g.header").data(COLUMNS, (d) => d.key);

  const entered = headers.enter().append("g").attr("class", "header");
  entered.append("rect").attr("class", (d) => `column-header ${d.exponent < 0 ? "decimal-column" : ""}`);
  entered.append("foreignObject").attr("class", "fraction-host");
  entered.append("text").attr("class", "header-text word-label");

  const merged = entered.merge(headers);
  merged.attr("transform", (_, index) => `translate(${layout.marginLeft + index * layout.columnWidth},${layout.marginTop})`);
  merged
    .select("rect")
    .attr("width", layout.columnWidth)
    .attr("height", layout.headerHeight)
    .attr("class", (d) => {
      const classes = ["column-header"];
      if (d.exponent < 0) classes.push("decimal-column");
      if (d.exponent === 0) classes.push("ones-column");
      return classes.join(" ");
    });

  merged
    .select(".fraction-host")
    .attr("x", 8)
    .attr("y", 34)
    .attr("width", layout.columnWidth - 16)
    .attr("height", 52)
    .style("display", headerStyle === "fractions" ? null : "none")
    .html((d) => `<div class="fraction-label">${renderFraction(d)}</div>`);

  merged
    .select(".word-label")
    .style("display", headerStyle === "words" ? null : "none")
    .attr("x", layout.columnWidth / 2)
    .attr("y", layout.headerHeight / 2)
    .attr("transform", `rotate(-90 ${layout.columnWidth / 2} ${layout.headerHeight / 2})`)
    .text((d) => d.word);
}

function renderFraction(column) {
  if (!window.katex) {
    return column.fraction === "1" ? "1" : column.fraction;
  }
  return katex.renderToString(column.fraction, { throwOnError: false, displayMode: false });
}

function renderGrid() {
  const bodyRows = [0, 1];
  const bodies = svg.select(".bodies").selectAll("g.body-row").data(bodyRows);
  const enteredRows = bodies.enter().append("g").attr("class", "body-row");
  enteredRows.append("text").attr("class", "row-label");
  enteredRows.append("line").attr("class", "row-rule");
  enteredRows.append("g").attr("class", "cells");

  const mergedRows = enteredRows.merge(bodies);
  mergedRows.attr("transform", (d) => `translate(0,${rowY(d)})`);
  mergedRows
    .select(".row-label")
    .attr("x", layout.marginLeft - 18)
    .attr("y", layout.rowHeight / 2)
    .text((d) => (d === 0 ? "start" : "result"));
  mergedRows
    .select(".row-rule")
    .attr("x1", layout.marginLeft - 8)
    .attr("x2", layout.width - 36)
    .attr("y1", layout.rowHeight)
    .attr("y2", layout.rowHeight);

  mergedRows.each(function (row) {
    const cells = d3.select(this).select(".cells").selectAll("rect").data(COLUMNS, (d) => d.key);
    cells
      .enter()
      .append("rect")
      .merge(cells)
      .attr("x", (_, index) => layout.marginLeft + index * layout.columnWidth)
      .attr("y", 0)
      .attr("width", layout.columnWidth)
      .attr("height", layout.rowHeight)
      .attr("class", (d) => {
        const classes = ["column-body"];
        if (d.exponent < 0) classes.push("decimal-column");
        if (d.exponent === 0) classes.push("ones-column");
        return classes.join(" ");
      });
  });
}

function renderZeros(group, occupied, rowIndex, zeroFill) {
  const zeroData = zeroFill
    ? COLUMNS.filter((column) => !occupied.has(column.exponent)).map((column) => ({
        exponent: column.exponent,
        rowIndex,
      }))
    : [];

  group
    .selectAll("text.zero-placeholder")
    .data(zeroData, (d) => `${d.rowIndex}-${d.exponent}`)
    .join("text")
    .attr("class", "zero-placeholder")
    .attr("x", (d) => xForExponent(d.exponent))
    .attr("y", (d) => tokenY(d.rowIndex))
    .text("0");
}

function digitDataFromMap(map, rowIndex, prefix) {
  return Array.from(map, ([exponent, digit]) => ({
    id: `${prefix}-${exponent}-${digit}`,
    exponent,
    digit,
    rowIndex,
  })).sort((a, b) => b.exponent - a.exponent);
}

function renderStaticDigits(group, data) {
  const tokens = group.selectAll("g.static-token").data(data, (d) => d.id);
  const entered = tokens.enter().append("g").attr("class", "static-token");
  entered.append("circle").attr("class", "digit-token").attr("r", layout.tokenSize / 2);
  entered.append("text").attr("class", "digit-text");

  entered
    .merge(tokens)
    .attr("transform", (d) => `translate(${xForExponent(d.exponent)},${tokenY(d.rowIndex)})`)
    .select(".digit-text")
    .text((d) => d.digit);

  tokens.exit().remove();
}

function renderMovementLabels(operation, power) {
  const direction = operation === "multiply" ? "left" : "right";
  const sign = operation === "multiply" ? -1 : 1;
  const arrowY = layout.marginTop + layout.headerHeight + layout.rowHeight + layout.rowGap / 2;
  const startX = xForExponent(0);
  const endX = startX + sign * power * layout.columnWidth;
  const midX = (startX + endX) / 2;
  const line = d3.line().curve(d3.curveBumpX);
  const path = line([
    [startX, arrowY],
    [midX, arrowY + 34],
    [endX, arrowY],
  ]);

  svg.select(".movement-path").selectAll("path").data([path]).join("path").attr("class", "arrow-path").attr("d", (d) => d);
  svg
    .select(".movement-path")
    .selectAll("text")
    .data([`${power} place${power === 1 ? "" : "s"} ${direction}`])
    .join("text")
    .attr("class", "arrow-label")
    .attr("x", midX)
    .attr("y", arrowY - 10)
    .text((d) => d);
}

function animateDigits(sourceMap, operation, power, version) {
  const movingLayer = svg.select(".moving");
  movingLayer.selectAll("*").remove();

  const direction = operation === "multiply" ? 1 : -1;
  const data = digitDataFromMap(sourceMap, 0, `moving-${version}`).map((digit, index) => ({
    ...digit,
    targetExponent: digit.exponent + direction * power,
    delay: index * 420,
  }));

  const visibleData = data.filter((d) => d.targetExponent >= -3 && d.targetExponent <= 3);
  const tokens = movingLayer.selectAll("g.moving-token").data(visibleData, (d) => d.id);
  const entered = tokens.enter().append("g").attr("class", "moving-token");
  entered.append("circle").attr("class", "digit-token").attr("r", layout.tokenSize / 2);
  entered.append("text").attr("class", "digit-text").text((d) => d.digit);

  entered
    .attr("transform", (d) => `translate(${xForExponent(d.exponent)},${tokenY(0)})`)
    .transition()
    .delay((d) => d.delay)
    .duration(780)
    .ease(d3.easeCubicInOut)
    .attr("transform", (d) => `translate(${xForExponent(d.targetExponent)},${tokenY(1)})`);
}

function updateSummary(parsed, result, settings) {
  const before = formatValue(parsed.number);
  const after = formatValue(result);
  const factor = 10 ** settings.power;
  const direction = settings.operation === "multiply" ? "left" : "right";
  const places = `${settings.power} place${settings.power === 1 ? "" : "s"}`;

  calculationText.textContent = `${before} ${operatorSymbol(settings.operation)} ${factor} = ${after}`;
  beforeNumber.textContent = before;
  afterNumber.textContent = after;
  movementText.textContent = `Each digit moves ${places} to the ${direction}. The decimal point stays fixed; the digits change columns.`;
}

function clearError() {
  inputError.hidden = true;
  inputError.textContent = "";
}

function showError(message) {
  inputError.hidden = false;
  inputError.textContent = message;
  calculationText.textContent = "Choose a value that fits the chart";
  beforeNumber.textContent = " ";
  afterNumber.textContent = " ";
  movementText.textContent = "The chart shows places from thousands through thousandths.";
}

function render() {
  renderVersion += 1;
  const version = renderVersion;
  const settings = getSettings();

  try {
    const parsed = parseNumber(settings.rawNumber || "0");
    const sourceMap = digitMap(parsed);
    const result = calculateValue(parsed.number, settings.operation, settings.power);
    const resultParsed = parseNumber(formatValue(result));
    const movementMap = shiftedDigitMap(sourceMap, settings.operation, settings.power);
    const resultMap = digitMap(resultParsed);

    if (Math.max(...movementMap.keys(), 0) > 3 || Math.min(...movementMap.keys(), 0) < -3) {
      throw new Error("That result moves beyond the chart. Try a smaller number or a smaller power of ten.");
    }

    clearError();
    svg.attr("viewBox", `0 0 ${layout.width} ${layout.height}`);
    svg.selectAll("*").interrupt();

    const rootGroups = ["headers", "bodies", "zeros-start", "zeros-result", "static-start", "static-result", "movement-path", "moving"];
    rootGroups.forEach((className) => {
      if (svg.select(`.${className}`).empty()) svg.append("g").attr("class", className);
    });

    renderHeaders(settings.headerStyle);
    renderGrid();
    renderMovementLabels(settings.operation, settings.power);
    renderZeros(svg.select(".zeros-start"), sourceMap, 0, settings.zeroFill);
    renderZeros(svg.select(".zeros-result"), resultMap, 1, settings.zeroFill);
    renderStaticDigits(svg.select(".static-start"), digitDataFromMap(sourceMap, 0, `start-${version}`));
    renderStaticDigits(svg.select(".static-result"), []);
    updateSummary(parsed, result, settings);

    window.setTimeout(() => {
      if (version !== renderVersion) return;
      renderStaticDigits(svg.select(".static-result"), digitDataFromMap(resultMap, 1, `result-${version}`));
    }, digitDataFromMap(sourceMap, 0, "timing").length * 420 + 790);

    animateDigits(sourceMap, settings.operation, settings.power, version);

    void movementMap;
  } catch (error) {
    showError(error.message);
    svg.selectAll("*").remove();
  }
}

controls.addEventListener("input", render);
controls.addEventListener("change", render);
replayButton.addEventListener("click", render);

window.addEventListener("load", render);

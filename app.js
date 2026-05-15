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
const animateButton = document.querySelector("#animateButton");
const numberInput = document.querySelector("#numberInput");
const powerSelect = document.querySelector("#powerSelect");
const zeroFillInput = document.querySelector("#zeroFill");
const hideGridInput = document.querySelector("#hideGrid");
const speedSlider = document.querySelector("#speedSlider");
const inputError = document.querySelector("#inputError");
const calculationText = document.querySelector("#calculationText");

const layout = {
  width: 1160,
  height: 790,
  marginLeft: 142,
  marginTop: 28,
  columnWidth: 132,
  headerHeight: 118,
  rowHeight: 128,
  rowGap: 62,
  digitInset: 12,
  decimalGap: 34,
};

const BASE_ANIMATION = { delay: 360, duration: 760 };

const formatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 12,
  useGrouping: false,
});

let renderVersion = 0;
let revealed = false;

function getSettings() {
  return {
    rawNumber: numberInput.value.trim(),
    operation: new FormData(controls).get("operation"),
    power: Number(powerSelect.value),
    headerStyle: new FormData(controls).get("headerStyle"),
    zeroFill: zeroFillInput.checked,
    hideGrid: hideGridInput.checked,
    speed: Number(speedSlider.value),
  };
}

function applyUrlSettings() {
  const params = new URLSearchParams(window.location.search);
  const operation = params.get("operation");
  const power = params.get("power");
  const headers = params.get("headers");
  const zeros = params.get("zeros");
  const grid = params.get("grid");
  const speed = params.get("speed");
  const number = params.get("number");

  if (number !== null) numberInput.value = number;
  if (operation === "multiply" || operation === "divide") {
    const input = controls.querySelector(`input[name="operation"][value="${operation}"]`);
    if (input) input.checked = true;
  }
  if (["1", "2", "3"].includes(power)) powerSelect.value = power;
  if (headers === "fractions" || headers === "words") {
    const input = controls.querySelector(`input[name="headerStyle"][value="${headers}"]`);
    if (input) input.checked = true;
  }
  if (zeros === "1") zeroFillInput.checked = true;
  if (zeros === "0") zeroFillInput.checked = false;
  if (grid === "0") hideGridInput.checked = true;
  if (grid === "1") hideGridInput.checked = false;
  if (speed === "slow") speedSlider.value = "0.5";
  if (speed === "normal") speedSlider.value = "1";
  if (speed === "fast") speedSlider.value = "2";
  if (speed !== null && !Number.isNaN(Number(speed))) {
    speedSlider.value = String(Math.min(2, Math.max(0.25, Number(speed))));
  }
}

function updateUrlSettings() {
  const settings = getSettings();
  const params = new URLSearchParams();
  params.set("number", settings.rawNumber || "0");
  params.set("operation", settings.operation);
  params.set("power", String(settings.power));
  params.set("headers", settings.headerStyle);
  params.set("zeros", settings.zeroFill ? "1" : "0");
  params.set("grid", settings.hideGrid ? "0" : "1");
  params.set("speed", String(settings.speed));
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
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
  const highestExponent = integerPart === "0" ? 0 : integerPart.length - 1;
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

function displayMap(baseMap, zeroFill) {
  if (!zeroFill) return new Map(baseMap);
  const map = new Map(baseMap);
  COLUMNS.forEach((column) => {
    if (!map.has(column.exponent)) {
      map.set(column.exponent, "0");
    }
  });
  return map;
}

function shiftedDigitMap(sourceMap, operation, power, zeroFill) {
  const direction = operation === "multiply" ? 1 : -1;
  const result = new Map();
  displayMap(sourceMap, zeroFill).forEach((digit, exponent) => {
    result.set(exponent + direction * power, digit);
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

function xForIndex(index) {
  const gap = index >= 4 ? layout.decimalGap : 0;
  return layout.marginLeft + index * layout.columnWidth + gap;
}

function xForExponent(exponent) {
  const index = COLUMNS.findIndex((column) => column.exponent === exponent);
  return xForIndex(index) + layout.columnWidth / 2;
}

function rowY(rowIndex) {
  return layout.marginTop + layout.headerHeight + rowIndex * (layout.rowHeight + layout.rowGap);
}

function tokenY(rowIndex) {
  return rowY(rowIndex) + layout.rowHeight / 2;
}

function decimalX() {
  return layout.marginLeft + 4 * layout.columnWidth + layout.decimalGap / 2;
}

function renderHeaders(headerStyle) {
  const headers = svg.select(".headers").selectAll("g.header").data(COLUMNS, (d) => d.key);

  const entered = headers.enter().append("g").attr("class", "header");
  entered.append("rect");
  entered.append("foreignObject").attr("class", "fraction-host");
  entered.append("text").attr("class", "header-text word-label");

  const merged = entered.merge(headers);
  merged.attr("transform", (_, index) => `translate(${xForIndex(index)},${layout.marginTop})`);
  merged
    .select("rect")
    .attr("width", layout.columnWidth)
    .attr("height", layout.headerHeight)
    .attr("class", (d) => cellClass("column-header", d.exponent));

  merged
    .select(".fraction-host")
    .attr("x", 4)
    .attr("y", 0)
    .attr("width", layout.columnWidth - 8)
    .attr("height", layout.headerHeight)
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

function cellClass(base, exponent) {
  const classes = [base];
  if (exponent < 0) classes.push("decimal-column");
  return classes.join(" ");
}

function renderGrid(showCorrectRow = false) {
  const rows = [
    { index: 0, label: "start" },
    { index: 1, label: "correct", isCorrect: true },
    { index: 2, label: "your answer" },
  ];
  const bodies = svg.select(".bodies").selectAll("g.body-row").data(rows, (d) => d.index);
  const enteredRows = bodies.enter().append("g").attr("class", "body-row");
  enteredRows.append("text").attr("class", "row-label");
  enteredRows.append("g").attr("class", "cells");

  const mergedRows = enteredRows.merge(bodies);
  mergedRows.attr("transform", (d) => `translate(0,${rowY(d.index)})`);
  mergedRows
    .select(".row-label")
    .attr("x", layout.marginLeft - 18)
    .attr("y", layout.rowHeight / 2)
    .attr("class", (d) => `row-label${d.isCorrect && !showCorrectRow ? " hidden-row" : ""}`)
    .text((d) => d.label);

  mergedRows.each(function (row) {
    const cells = d3.select(this).select(".cells").selectAll("rect").data(COLUMNS, (d) => d.key);
    cells
      .enter()
      .append("rect")
      .merge(cells)
      .attr("x", (_, index) => xForIndex(index))
      .attr("y", 0)
      .attr("width", layout.columnWidth)
      .attr("height", layout.rowHeight)
      .attr("class", (d) => {
        const baseClass = cellClass("column-body", d.exponent);
        return row.isCorrect && !showCorrectRow ? `${baseClass} hidden-row` : baseClass;
      });
  });

  bodies.exit().remove();
}

function applyGridVisibility(hideGrid) {
  svg.classed("hide-grid", hideGrid);
}

function renderDecimalMarks() {
  const marks = [
    { y: tokenY(0) + 30, label: "." },
    { y: tokenY(1) + 30, label: ".", isCorrect: true },
    { y: tokenY(2) + 30, label: "." },
  ];

  svg.select(".decimal-markers").selectAll("line").data([]).join("line");

  svg
    .select(".decimal-markers")
    .selectAll("text")
    .data(marks)
    .join("text")
    .attr("class", (d) => `decimal-point${d.isCorrect && !revealed ? " hidden-row" : ""}`)
    .attr("x", decimalX())
    .attr("y", (d) => d.y)
    .text((d) => d.label);
}

function digitDataFromMap(map, rowIndex, prefix, paleZeros = false) {
  return Array.from(map, ([exponent, digit]) => ({
    id: `${prefix}-${exponent}`,
    exponent,
    digit,
    rowIndex,
    isPale: paleZeros && digit === "0",
  })).sort((a, b) => b.exponent - a.exponent);
}

function renderStaticDigits(group, data) {
  const tokens = group.selectAll("text.cell-digit").data(data, (d) => d.id);
  tokens
    .enter()
    .append("text")
    .attr("class", "cell-digit")
    .merge(tokens)
    .attr("class", (d) => `cell-digit${d.isPale ? " pale-digit" : ""}`)
    .attr("x", (d) => xForExponent(d.exponent))
    .attr("y", (d) => tokenY(d.rowIndex))
    .text((d) => d.digit);

  tokens.exit().remove();
}

function renderAnswerInputs() {
  const host = svg.select(".answer-inputs");
  const inputs = host.selectAll("foreignObject.answer-cell-host").data(COLUMNS, (d) => d.key);

  inputs
    .enter()
    .append("foreignObject")
    .attr("class", "answer-cell-host")
    .merge(inputs)
    .attr("x", (_, index) => xForIndex(index) + layout.digitInset)
    .attr("y", rowY(2) + layout.digitInset)
    .attr("width", layout.columnWidth - layout.digitInset * 2)
    .attr("height", layout.rowHeight - layout.digitInset * 2)
    .html((d) => `<input class="answer-cell" data-exponent="${d.exponent}" maxlength="1" inputmode="numeric" aria-label="${d.word} answer digit" />`);

  inputs.exit().remove();
}

function bindAnswerInputs() {
  document.querySelectorAll(".answer-cell").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      revealed = false;
      svg.select(".moving").selectAll("*").remove();
      svg.select(".static-result").selectAll("*").remove();
      svg.select(".movement-path").selectAll("*").remove();
      renderGrid(false);
      renderDecimalMarks();
      svg.select(".answer-feedback-layer").selectAll("*").remove();
      clearInputStates();
    });
  });
}

function clearAnswerInputs() {
  document.querySelectorAll(".answer-cell").forEach((input) => {
    input.value = "";
  });
  clearInputStates();
}

function clearInputStates() {
  document.querySelectorAll(".answer-cell").forEach((input) => {
    input.classList.remove("answer-correct", "answer-incorrect");
  });
}

function answerValue() {
  let total = 0;
  document.querySelectorAll(".answer-cell").forEach((input) => {
    const digit = input.value.trim();
    if (digit) {
      total += Number(digit) * 10 ** Number(input.dataset.exponent);
    }
  });
  return Number(total.toPrecision(14));
}

function answerDisplay() {
  const entries = Array.from(document.querySelectorAll(".answer-cell"))
    .map((input) => ({
      exponent: Number(input.dataset.exponent),
      digit: input.value.trim(),
    }))
    .filter((entry) => entry.digit)
    .sort((a, b) => b.exponent - a.exponent);

  if (!entries.length) return "";

  const highest = Math.max(...entries.map((entry) => entry.exponent), 0);
  const lowest = Math.min(...entries.map((entry) => entry.exponent), 0);
  const digitsByExponent = new Map(entries.map((entry) => [entry.exponent, entry.digit]));
  let text = "";

  for (let exponent = highest; exponent >= lowest; exponent -= 1) {
    if (exponent === -1) text += ".";
    text += digitsByExponent.get(exponent) || "0";
  }

  return text.replace(/^0+(?=\d)/, "") || "0";
}

function markAnswer(resultMap, userCorrect) {
  document.querySelectorAll(".answer-cell").forEach((input) => {
    const exponent = Number(input.dataset.exponent);
    const expected = resultMap.get(exponent) || "";
    const entered = input.value.trim();
    const cellCorrect = entered === expected || (!entered && (!expected || expected === "0"));
    input.classList.toggle("answer-correct", userCorrect || cellCorrect);
    input.classList.toggle("answer-incorrect", !userCorrect && !cellCorrect);
  });
}

function renderMovementArrows(sourceMap, operation, power, zeroFill) {
  const direction = operation === "multiply" ? 1 : -1;
  const arrowData = digitDataFromMap(displayMap(sourceMap, zeroFill), 0, "arrow", zeroFill)
    .map((digit, index) => ({
      ...digit,
      targetExponent: digit.exponent + direction * power,
    }))
    .filter((d) => d.targetExponent >= -3 && d.targetExponent <= 3);

  const layer = svg.select(".movement-path");
  const defs = svg.select("defs").empty() ? svg.append("defs") : svg.select("defs");
  defs
    .selectAll("marker#arrowHead")
    .data([0])
    .join("marker")
    .attr("id", "arrowHead")
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 8)
    .attr("refY", 5)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto-start-reverse");
  defs
    .select("marker#arrowHead")
    .selectAll("path")
    .data([0])
    .join("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", "#6c7d8c");

  layer
    .selectAll("line.arrow-path")
    .data(arrowData, (d) => d.id)
    .join("line")
    .attr("class", (d) => `arrow-path${d.isPale ? " pale-arrow" : ""}`)
    .attr("marker-end", "url(#arrowHead)")
    .attr("x1", (d) => xForExponent(d.exponent))
    .attr("y1", rowY(0) + layout.rowHeight)
    .attr("x2", (d) => xForExponent(d.targetExponent))
    .attr("y2", rowY(1));
}

function animateDigits(sourceMap, operation, power, zeroFill, version) {
  const movingLayer = svg.select(".moving");
  movingLayer.selectAll("*").remove();

  const direction = operation === "multiply" ? 1 : -1;
  const speedFactor = Math.min(2, Math.max(0.25, getSettings().speed || 0.5));
  const speed = {
    delay: BASE_ANIMATION.delay / speedFactor,
    duration: BASE_ANIMATION.duration / speedFactor,
  };
  const data = digitDataFromMap(displayMap(sourceMap, zeroFill), 0, `moving-${version}`, zeroFill).map((digit, index) => ({
    ...digit,
    targetExponent: digit.exponent + direction * power,
    delay: index * speed.delay,
  }));

  const visibleData = data.filter((d) => d.targetExponent >= -3 && d.targetExponent <= 3);
  const tokens = movingLayer.selectAll("text.moving-digit").data(visibleData, (d) => d.id);

  tokens
    .enter()
    .append("text")
    .attr("class", (d) => `moving-digit cell-digit${d.isPale ? " pale-digit" : ""}`)
    .attr("x", (d) => xForExponent(d.exponent))
    .attr("y", tokenY(0))
    .text((d) => d.digit)
    .transition()
    .delay((d) => d.delay)
    .duration(speed.duration)
    .ease(d3.easeCubicInOut)
    .attr("x", (d) => xForExponent(d.targetExponent))
    .attr("y", tokenY(1));
}

function renderQuestion(parsed, settings) {
  const before = formatValue(parsed.number);
  const factor = 10 ** settings.power;
  calculationText.textContent = `What is ${before} ${operatorSymbol(settings.operation)} ${factor}?`;
}

function renderAnswerFeedback(userAnswer, userCorrect) {
  const text = userAnswer ? `${userAnswer} is ${userCorrect ? "correct" : "incorrect"}` : "No answer entered";
  svg
    .select(".answer-feedback-layer")
    .selectAll("text")
    .data([text])
    .join("text")
    .attr("class", `answer-feedback ${userCorrect ? "correct-feedback" : "incorrect-feedback"}`)
    .attr("x", layout.marginLeft + (COLUMNS.length * layout.columnWidth + layout.decimalGap) / 2)
    .attr("y", rowY(2) + layout.rowHeight + 54)
    .text((d) => d);
}

function clearError() {
  inputError.hidden = true;
  inputError.textContent = "";
}

function showError(message) {
  inputError.hidden = false;
  inputError.textContent = message;
  calculationText.textContent = "Choose a value that fits the chart";
}

function buildState() {
  const settings = getSettings();
  const parsed = parseNumber(settings.rawNumber || "0");
  const sourceMap = digitMap(parsed);
  const result = calculateValue(parsed.number, settings.operation, settings.power);
  const resultParsed = parseNumber(formatValue(result));
  const resultMap = digitMap(resultParsed);
  const movementMap = shiftedDigitMap(sourceMap, settings.operation, settings.power, false);

  if (Math.max(...movementMap.keys(), 0) > 3 || Math.min(...movementMap.keys(), 0) < -3) {
    throw new Error("That result moves beyond the chart. Try a smaller number or a smaller power of ten.");
  }

  return { settings, parsed, sourceMap, result, resultMap };
}

function ensureSvgGroups() {
  const rootGroups = [
    "headers",
    "bodies",
    "decimal-markers",
    "static-start",
    "answer-inputs",
    "movement-path",
    "static-result",
    "moving",
    "answer-feedback-layer",
  ];
  rootGroups.forEach((className) => {
    if (svg.select(`.${className}`).empty()) svg.append("g").attr("class", className);
  });
}

function renderBase(resetAnswer = false) {
  renderVersion += 1;
  revealed = false;

  try {
    const { settings, parsed, sourceMap, result } = buildState();
    clearError();
    svg.attr("viewBox", `0 0 ${layout.width} ${layout.height}`);
    svg.selectAll("*").interrupt();
    svg.selectAll("*").remove();
    ensureSvgGroups();

    renderHeaders(settings.headerStyle);
    renderGrid();
    applyGridVisibility(settings.hideGrid);
    renderDecimalMarks();
    renderStaticDigits(
      svg.select(".static-start"),
      digitDataFromMap(displayMap(sourceMap, settings.zeroFill), 0, `start-${renderVersion}`, settings.zeroFill),
    );
    renderAnswerInputs();
    bindAnswerInputs();
    svg.select(".static-result").selectAll("*").remove();
    svg.select(".moving").selectAll("*").remove();
    svg.select(".movement-path").selectAll("*").remove();
    svg.select(".answer-feedback-layer").selectAll("*").remove();
    if (resetAnswer) clearAnswerInputs();
    renderQuestion(parsed, settings);
    updateUrlSettings();
  } catch (error) {
    showError(error.message);
    svg.selectAll("*").remove();
  }
}

function revealAnswer() {
  renderVersion += 1;
  const version = renderVersion;

  try {
    const { settings, parsed, sourceMap, result, resultMap } = buildState();
    const userCorrect = Math.abs(answerValue() - result) < 1e-10;
    const userAnswer = answerDisplay();
    revealed = true;

    clearError();
    clearInputStates();
    markAnswer(displayMap(resultMap, settings.zeroFill), userCorrect);
    svg.selectAll("*").interrupt();
    renderGrid(true);
    applyGridVisibility(settings.hideGrid);
    renderDecimalMarks();
    svg.select(".static-result").selectAll("*").remove();
    svg.select(".moving").selectAll("*").remove();
    renderMovementArrows(sourceMap, settings.operation, settings.power, settings.zeroFill);
    renderQuestion(parsed, settings);
    renderAnswerFeedback(userAnswer, userCorrect);
    animateDigits(sourceMap, settings.operation, settings.power, settings.zeroFill, version);

    const speedFactor = Math.min(2, Math.max(0.25, settings.speed || 0.5));
    const speed = {
      delay: BASE_ANIMATION.delay / speedFactor,
      duration: BASE_ANIMATION.duration / speedFactor,
    };
    window.setTimeout(() => {
      if (version !== renderVersion || !revealed) return;
      renderStaticDigits(
        svg.select(".static-result"),
        digitDataFromMap(displayMap(resultMap, settings.zeroFill), 1, `result-${version}`, settings.zeroFill),
      );
    }, digitDataFromMap(displayMap(sourceMap, settings.zeroFill), 0, "timing").length * speed.delay + speed.duration + 20);
    updateUrlSettings();
  } catch (error) {
    showError(error.message);
    svg.selectAll("*").remove();
  }
}

controls.addEventListener("input", (event) => {
  if (event.target.classList.contains("answer-cell")) return;
  renderBase(true);
});
controls.addEventListener("change", (event) => {
  if (event.target.classList.contains("answer-cell")) return;
  renderBase(true);
});
animateButton.addEventListener("click", revealAnswer);

window.addEventListener("load", () => {
  applyUrlSettings();
  renderBase(false);
});

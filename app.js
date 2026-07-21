const PLACE_NAMES = new Map([
  [0, "ones"],
  [1, "tens"],
  [2, "hundreds"],
  [3, "thousands"],
  [4, "ten thousands"],
  [5, "hundred thousands"],
  [6, "millions"],
  [7, "ten millions"],
  [8, "hundred millions"],
  [9, "billions"],
  [-1, "tenths"],
  [-2, "hundredths"],
  [-3, "thousandths"],
  [-4, "ten-thousandths"],
  [-5, "hundred-thousandths"],
  [-6, "millionths"],
  [-7, "ten-millionths"],
  [-8, "hundred-millionths"],
  [-9, "billionths"],
]);

let COLUMNS = [];

const svg = d3.select("#placeValueSvg");
const controls = document.querySelector("#controls");
const animateButton = document.querySelector("#animateButton");
const numberInput = document.querySelector("#numberInput");
const operationPowerSelect = document.querySelector("#operationPowerSelect");
const speedSlider = document.querySelector("#speedSlider");
const clickAnimateInput = document.querySelector("#clickAnimate");
const inputError = document.querySelector("#inputError");
const calculationText = document.querySelector("#calculationText");

const layout = {
  width: 900,
  height: 520,
  marginLeft: 92,
  marginTop: 16,
  columnWidth: 104,
  headerHeight: 72,
  rowHeight: 84,
  rowGap: 38,
  digitInset: 8,
  decimalGap: 24,
};

function columnForExponent(exponent) {
  const word = PLACE_NAMES.get(exponent) || (exponent > 0 ? `10^${exponent}s` : `10^${exponent}`);
  let fraction = "1";
  if (exponent > 0) fraction = `1${"0".repeat(exponent)}`;
  if (exponent < 0) fraction = `\\frac{1}{1${"0".repeat(Math.abs(exponent))}}`;
  return { key: `place-${exponent}`, exponent, word, fraction };
}

function configureColumns(...maps) {
  const exponents = maps.flatMap((map) => Array.from(map.keys()));
  const highestExponent = Math.max(3, ...exponents);
  const lowestExponent = Math.min(-3, ...exponents);
  COLUMNS = d3.range(highestExponent, lowestExponent - 1, -1).map(columnForExponent);
  layout.width = layout.marginLeft + COLUMNS.length * layout.columnWidth + layout.decimalGap + 56;
}

const BASE_ANIMATION = { delay: 360, duration: 760 };

let renderVersion = 0;
let revealed = false;
let clickedAnimationKeys = new Set();
let clickedAnimationData = new Map();
let clickedResultData = new Map();

function getSettings() {
  const [operation, rawPower] = operationPowerSelect.value.split(":");
  return {
    rawNumber: numberInput.value.trim(),
    operation,
    power: Number(rawPower),
    headerStyle: new FormData(controls).get("headerStyle"),
    speed: Number(speedSlider.value),
    clickAnimate: clickAnimateInput.checked,
  };
}

function applyUrlSettings() {
  const params = new URLSearchParams(window.location.search);
  const transform = params.get("transform");
  const operation = params.get("operation");
  const power = params.get("power");
  const headers = params.get("headers");
  const speed = params.get("speed");
  const animate = params.get("animate");
  const number = params.get("number");

  if (number !== null) numberInput.value = number;
  if (["multiply:1", "multiply:2", "multiply:3", "divide:1", "divide:2", "divide:3"].includes(transform)) {
    operationPowerSelect.value = transform;
  } else if ((operation === "multiply" || operation === "divide") && ["1", "2", "3"].includes(power)) {
    operationPowerSelect.value = `${operation}:${power}`;
  }
  if (headers === "fractions" || headers === "words") {
    const input = controls.querySelector(`input[name="headerStyle"][value="${headers}"]`);
    if (input) input.checked = true;
  }
  if (speed === "slow") speedSlider.value = "0.5";
  if (speed === "normal") speedSlider.value = "1";
  if (speed === "fast") speedSlider.value = "2";
  if (speed !== null && !Number.isNaN(Number(speed))) {
    speedSlider.value = String(Math.min(2, Math.max(0.25, Number(speed))));
  }
  if (animate === "click") clickAnimateInput.checked = true;
  if (animate === "auto") clickAnimateInput.checked = false;
}

function updateUrlSettings() {
  const settings = getSettings();
  const params = new URLSearchParams();
  params.set("number", settings.rawNumber || "0");
  params.set("transform", `${settings.operation}:${settings.power}`);
  params.set("headers", settings.headerStyle);
  params.set("speed", String(settings.speed));
  params.set("animate", settings.clickAnimate ? "click" : "auto");
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
  if (integerPart.length + decimalPart.length > 30) {
    throw new Error("Use no more than 30 digits so the place value chart remains readable.");
  }

  return { number, integerPart, decimalPart };
}

function digitMap(parsed) {
  const map = new Map();
  const integerDigits = parsed.integerPart.padStart(1, "0").split("");
  const startExponent = integerDigits.length - 1;

  integerDigits.forEach((digit, index) => {
    const exponent = startExponent - index;
    map.set(exponent, digit);
  });

  parsed.decimalPart.split("").forEach((digit, index) => {
    const exponent = -(index + 1);
    map.set(exponent, digit);
  });

  if (!map.size) {
    map.set(0, "0");
  }

  return map;
}

function displayMap(baseMap) {
  const map = new Map(baseMap);
  COLUMNS.forEach((column) => {
    if (!map.has(column.exponent)) {
      map.set(column.exponent, "0");
    }
  });
  return map;
}

function shiftedDigitMap(sourceMap, operation, power) {
  const direction = operation === "multiply" ? 1 : -1;
  const result = new Map();
  sourceMap.forEach((digit, exponent) => {
    result.set(exponent + direction * power, digit);
  });
  return result;
}

function valueStringFromMap(map) {
  const highestExponent = Math.max(0, ...map.keys());
  const lowestExponent = Math.min(0, ...map.keys());
  let value = "";

  for (let exponent = highestExponent; exponent >= lowestExponent; exponent -= 1) {
    if (exponent === -1) value += ".";
    value += map.get(exponent) || "0";
  }

  const [integerPart, decimalPart] = value.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "") || "0";
  return decimalPart === undefined ? normalizedInteger : `${normalizedInteger}.${decimalPart}`;
}

function operatorSymbol(operation) {
  return operation === "multiply" ? "×" : "÷";
}

function xForIndex(index) {
  const onesIndex = COLUMNS.findIndex((column) => column.exponent === 0);
  const gap = index > onesIndex ? layout.decimalGap : 0;
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
  const onesIndex = COLUMNS.findIndex((column) => column.exponent === 0);
  return layout.marginLeft + (onesIndex + 1) * layout.columnWidth + layout.decimalGap / 2;
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

function filledDigitData(baseMap, rowIndex, prefix, isNeeded = () => false) {
  return Array.from(displayMap(baseMap), ([exponent, digit]) => ({
    id: `${prefix}-${exponent}`,
    exponent,
    digit,
    rowIndex,
    isPale: digit === "0" && !baseMap.has(exponent) && !isNeeded(exponent),
  })).sort((a, b) => b.exponent - a.exponent);
}

function digitDataFromMap(map, rowIndex, prefix) {
  return Array.from(map, ([exponent, digit]) => ({
    id: `${prefix}-${exponent}`,
    exponent,
    digit,
    rowIndex,
    isPale: false,
  })).sort((a, b) => b.exponent - a.exponent);
}

function movementData(sourceMap, resultMap, operation, power, prefix = "move") {
  const direction = operation === "multiply" ? 1 : -1;
  return filledDigitData(sourceMap, 0, prefix, (exponent) => {
    const targetExponent = exponent + direction * power;
    return resultMap.get(targetExponent) === "0";
  })
    .map((digit) => ({
      ...digit,
      targetExponent: digit.exponent + direction * power,
    }))
    .filter((digit) => sourceMap.has(digit.exponent) || resultMap.get(digit.targetExponent) === "0");
}

function renderStaticDigits(group, data) {
  const tokens = group.selectAll("text.cell-digit").data(data, (d) => d.id);
  tokens
    .enter()
    .append("text")
    .attr("class", "cell-digit")
    .merge(tokens)
    .attr("class", (d) => `cell-digit${d.isPale ? " pale-digit" : ""}`)
    .attr("data-exponent", (d) => d.exponent)
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
    .html(
      (d, index) =>
        `<input class="answer-cell" data-exponent="${d.exponent}" data-column-index="${index}" maxlength="1" inputmode="numeric" aria-label="${d.word} answer digit" />`,
    );

  inputs.exit().remove();
}

function renderRevealButtons(sourceMap, resultMap, settings, version) {
  const data = movementData(sourceMap, resultMap, settings.operation, settings.power, `click-${version}`);
  const buttons = svg.select(".reveal-buttons").selectAll("foreignObject.reveal-button-host").data(data, (d) => d.id);

  buttons
    .enter()
    .append("foreignObject")
    .attr("class", "reveal-button-host")
    .merge(buttons)
    .attr("x", (d) => xForExponent(d.exponent) - 34)
    .attr("y", rowY(0) + layout.rowHeight + 14)
    .attr("width", 68)
    .attr("height", 34)
    .html((d) => `<button class="reveal-button" type="button" data-exponent="${d.exponent}">reveal</button>`);

  buttons.exit().remove();

  document.querySelectorAll(".reveal-button").forEach((button) => {
    button.addEventListener("click", () => {
      const didAnimate = animateClickedDigit(
        data.find((digit) => digit.exponent === Number(button.dataset.exponent)),
        resultMap,
        settings,
        data.length,
        version,
      );
      if (didAnimate) {
        button.closest(".reveal-button-host")?.remove();
      }
    });
  });
}

function bindAnswerInputs() {
  document.querySelectorAll(".answer-cell").forEach((input) => {
    input.addEventListener("input", (event) => {
      const digit = event.data?.match(/\d/)?.[0] || input.value.match(/\d/)?.[0] || "";
      input.value = digit;
      revealed = false;
      svg.select(".moving").selectAll("*").remove();
      svg.select(".static-result").selectAll("*").remove();
      svg.select(".movement-path").selectAll("*").remove();
      svg.select(".reveal-buttons").selectAll("*").remove();
      renderGrid(false);
      renderDecimalMarks();
      svg.select(".answer-feedback-layer").selectAll("*").remove();
      clearInputStates();
      if (digit) focusAnswerCell(input, 1);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value) {
        event.preventDefault();
        focusAnswerCell(input, -1, true);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusAnswerCell(input, -1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        focusAnswerCell(input, 1);
      }
    });
  });
}

function answerCells() {
  return Array.from(document.querySelectorAll(".answer-cell")).sort(
    (a, b) => Number(a.dataset.columnIndex) - Number(b.dataset.columnIndex),
  );
}

function focusAnswerCell(currentInput, direction, clearTarget = false) {
  const inputs = answerCells();
  const currentIndex = inputs.indexOf(currentInput);
  const target = inputs[currentIndex + direction];
  if (!target) return;
  target.focus();
  target.select();
  if (clearTarget) target.value = "";
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

function isAnswerCorrect(resultMap) {
  const inputs = Array.from(document.querySelectorAll(".answer-cell"));
  const hasAnswer = inputs.some((input) => input.value.trim());
  return (
    hasAnswer &&
    inputs.every((input) => {
      const expected = resultMap.get(Number(input.dataset.exponent)) || "0";
      const entered = input.value.trim();
      return entered === expected || (!entered && expected === "0");
    })
  );
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

function renderMovementArrows(sourceMap, resultMap, operation, power) {
  renderMovementArrowData(movementData(sourceMap, resultMap, operation, power, "arrow"));
}

function shortenedArrowEndpoints(digit) {
  const start = { x: xForExponent(digit.exponent), y: tokenY(0) };
  const end = { x: xForExponent(digit.targetExponent), y: tokenY(1) };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { start, end };

  const unit = { x: dx / length, y: dy / length };
  const digitClearance = 34;
  return {
    start: {
      x: start.x + unit.x * digitClearance,
      y: start.y + unit.y * digitClearance,
    },
    end: {
      x: end.x - unit.x * digitClearance,
      y: end.y - unit.y * digitClearance,
    },
  };
}

function renderMovementArrowData(arrowData) {
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
    .attr("x1", (d) => shortenedArrowEndpoints(d).start.x)
    .attr("y1", (d) => shortenedArrowEndpoints(d).start.y)
    .attr("x2", (d) => shortenedArrowEndpoints(d).end.x)
    .attr("y2", (d) => shortenedArrowEndpoints(d).end.y);
}

function animateDigits(sourceMap, resultMap, operation, power, version) {
  const movingLayer = svg.select(".moving");
  movingLayer.selectAll("*").remove();

  animateDigitData(movementData(sourceMap, resultMap, operation, power, `moving-${version}`), version, true);
}

function animationSpeed() {
  const speedFactor = Math.min(2, Math.max(0.25, getSettings().speed || 0.5));
  return {
    delay: BASE_ANIMATION.delay / speedFactor,
    duration: BASE_ANIMATION.duration / speedFactor,
  };
}

function animateDigitData(data, version, staggered) {
  const speed = animationSpeed();
  const movingLayer = svg.select(".moving");
  const animatedData = data.map((digit, index) => ({
    ...digit,
    delay: staggered ? index * speed.delay : 0,
  }));

  const tokens = movingLayer.selectAll("text.moving-digit").data(animatedData, (d) => d.id);

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

function renderQuestion(settings) {
  const before = settings.rawNumber || "0";
  const factor = 10 ** settings.power;
  calculationText.textContent = `What is ${before} ${operatorSymbol(settings.operation)} ${factor}?`;
}

function renderAnswerFeedback(userAnswer, correctAnswer, userCorrect) {
  const text = userAnswer
    ? userCorrect
      ? `${userAnswer} is correct`
      : `${userAnswer} is incorrect. The correct answer is ${correctAnswer}`
    : `No answer entered. The correct answer is ${correctAnswer}`;
  svg
    .select(".answer-feedback-layer")
    .selectAll("text")
    .data([text])
    .join("text")
    .attr("class", `answer-feedback ${userCorrect ? "correct-feedback" : "incorrect-feedback"}`)
    .attr("x", layout.marginLeft + (COLUMNS.length * layout.columnWidth + layout.decimalGap) / 2)
    .attr("y", rowY(2) + layout.rowHeight + 36)
    .text((d) => d);
}

function enableClickAnimations(sourceMap, resultMap, settings, version) {
  renderRevealButtons(sourceMap, resultMap, settings, version);
}

function animateClickedDigit(digit, resultMap, settings, totalReveals, version) {
  if (!digit || version !== renderVersion || clickedAnimationKeys.has(digit.id)) return false;
  clickedAnimationKeys.add(digit.id);
  clickedAnimationData.set(digit.id, digit);
  renderMovementArrowData(Array.from(clickedAnimationData.values()));
  animateDigitData([digit], version, false);
  window.setTimeout(() => {
    if (version !== renderVersion || !revealed) return;
    svg.select(".moving").selectAll("*").remove();
    if (clickedAnimationKeys.size >= totalReveals) {
      renderStaticDigits(
        svg.select(".static-result"),
        filledDigitData(resultMap, 1, `result-${version}`),
      );
    } else {
      clickedResultData.set(digit.id, {
        ...digit,
        id: `result-${version}-${digit.targetExponent}`,
        exponent: digit.targetExponent,
        rowIndex: 1,
      });
      renderStaticDigits(svg.select(".static-result"), Array.from(clickedResultData.values()));
    }
  }, animationSpeed().duration + 20);
  return true;
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
  const movementMap = shiftedDigitMap(sourceMap, settings.operation, settings.power);
  const resultText = valueStringFromMap(movementMap);
  const resultParsed = parseNumber(resultText);
  const resultMap = digitMap(resultParsed);
  configureColumns(sourceMap, resultMap);

  return { settings, sourceMap, resultMap, resultText };
}

function ensureSvgGroups() {
  const rootGroups = [
    "headers",
    "bodies",
    "decimal-markers",
    "static-start",
    "answer-inputs",
    "movement-path",
    "reveal-buttons",
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
  clickedAnimationKeys = new Set();
  clickedAnimationData = new Map();
  clickedResultData = new Map();

  try {
    const { settings, sourceMap, resultMap } = buildState();
    clearError();
    svg.attr("viewBox", `0 0 ${layout.width} ${layout.height}`).style("min-width", `${Math.max(780, layout.width)}px`);
    svg.selectAll("*").interrupt();
    svg.selectAll("*").remove();
    ensureSvgGroups();

    renderHeaders(settings.headerStyle);
    renderGrid();
    renderDecimalMarks();
    renderStaticDigits(
      svg.select(".static-start"),
      filledDigitData(sourceMap, 0, `start-${renderVersion}`, (exponent) => {
        const direction = settings.operation === "multiply" ? 1 : -1;
        return resultMap.get(exponent + direction * settings.power) === "0";
      }),
    );
    renderAnswerInputs();
    bindAnswerInputs();
    svg.select(".static-result").selectAll("*").remove();
    svg.select(".moving").selectAll("*").remove();
    svg.select(".movement-path").selectAll("*").remove();
    svg.select(".reveal-buttons").selectAll("*").remove();
    svg.select(".answer-feedback-layer").selectAll("*").remove();
    if (resetAnswer) clearAnswerInputs();
    renderQuestion(settings);
    updateUrlSettings();
  } catch (error) {
    showError(error.message);
    svg.selectAll("*").remove();
  }
}

function revealAnswer() {
  renderVersion += 1;
  const version = renderVersion;
  clickedAnimationKeys = new Set();
  clickedAnimationData = new Map();
  clickedResultData = new Map();

  try {
    const { settings, sourceMap, resultMap, resultText } = buildState();
    const userCorrect = isAnswerCorrect(resultMap);
    const userAnswer = answerDisplay();
    revealed = true;

    clearError();
    clearInputStates();
    markAnswer(displayMap(resultMap), userCorrect);
    svg.selectAll("*").interrupt();
    renderGrid(true);
    renderDecimalMarks();
    svg.select(".static-result").selectAll("*").remove();
    svg.select(".moving").selectAll("*").remove();
    renderQuestion(settings);
    renderAnswerFeedback(userAnswer, resultText, userCorrect);

    if (settings.clickAnimate) {
      enableClickAnimations(sourceMap, resultMap, settings, version);
    } else {
      renderMovementArrows(sourceMap, resultMap, settings.operation, settings.power);
      animateDigits(sourceMap, resultMap, settings.operation, settings.power, version);

      const speed = animationSpeed();
      window.setTimeout(() => {
        if (version !== renderVersion || !revealed) return;
        svg.select(".moving").selectAll("*").remove();
        renderStaticDigits(
          svg.select(".static-result"),
          filledDigitData(resultMap, 1, `result-${version}`),
        );
      }, movementData(sourceMap, resultMap, settings.operation, settings.power, "timing").length * speed.delay + speed.duration + 20);
    }
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

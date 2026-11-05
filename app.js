(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmtInt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const fmt1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt1trim = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
  const fmt2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const DEFAULTS = { kzt: 2000, model: "flash", tariff: "mix", scenario: "normal", rate: 452.91, vat: 6, bank: 2 };

  const state = { ...DEFAULTS };

  // USD per 1M tokens: [peak, off-peak]. Source: DeepSeek pricing, 5 Nov 2026.
  const PRICES = {
    flash: {
      hit:  [0.006, 0.003],
      miss: [0.30, 0.15],
      out:  [1.20, 0.60],
    },
    pro: {
      hit:  [0.044, 0.022],
      miss: [1.32, 0.66],
      out:  [3.96, 1.98],
    },
  };

  const SCENARIOS = {
    light:  { name: "аккуратно", req: 25,  ctx: 12000, cached: 0.70, out: 800 },
    normal: { name: "обычно",   req: 80,  ctx: 40000, cached: 0.80, out: 1500 },
    heavy:  { name: "всё подряд", req: 250, ctx: 70000, cached: 0.70, out: 2500 },
  };

  const ITEMS = [
    { id: "books",     input: 60000,   output: 360000, cached: 0,    forms: ["книга", "книги", "книг"] },
    { id: "war",       input: 1050000, output: 2000,   cached: 0,    forms: ["раз", "раза", "раз"] },
    { id: "hp",        input: 2200000, output: 2000,   cached: 0,    forms: ["серия", "серии", "серий"] },
    { id: "podcasts",  input: 25000,   output: 1500,   cached: 0,    forms: ["эпизод", "эпизода", "эпизодов"] },
    { id: "contracts", input: 30000,   output: 4000,   cached: 0,    forms: ["договор", "договора", "договоров"] },
    { id: "emails",    input: 400,     output: 250,    cached: 0,    forms: ["письмо", "письма", "писем"] },
    { id: "tasks",     input: 480000,  output: 18000,  cached: 0.80, forms: ["задача", "задачи", "задач"] },
    { id: "videos",    input: 2500,    output: 300,    cached: 0,    forms: ["видео", "видео", "видео"] },
    { id: "resumes",   input: 300,     output: 1200,   cached: 0,    forms: ["резюме", "резюме", "резюме"] },
    { id: "codebases", input: 1300000, output: 5000,   cached: 0,    forms: ["база", "базы", "баз"] },
  ];

  const amountInput = $("#amount");
  const rateInput = $("#rate");
  const vatInput = $("#vat");
  const bankInput = $("#bank");
  const copyButton = $("#copy");
  const hint = $("#amount-hint");
  const strip = $("#day-strip");

  for (let i = 0; i < 30; i++) {
    const cell = document.createElement("span");
    cell.className = "day-cell";
    strip.appendChild(cell);
  }
  const stripCells = $$(".day-cell", strip);

  // ------------------------------ helpers ------------------------------

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function plural(n, forms) {
    const whole = Math.floor(Math.abs(n));
    const mod10 = whole % 10;
    const mod100 = whole % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  }

  function displayCount(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value < 0.1) return 0.1;
    if (value < 10) return Math.round(value * 10) / 10;
    return Math.round(value);
  }

  function formatCount(value) {
    const v = displayCount(value);
    if (v < 0.1) return "<0,1";
    if (v < 10) return fmt1trim.format(v);
    return fmtInt.format(v);
  }

  function countUnit(value, forms) {
    const v = displayCount(value);
    if (v < 0.1) return forms[2];
    if (!Number.isInteger(v)) return forms[1];
    return plural(v, forms);
  }

  function formatDays(value) {
    if (!Number.isFinite(value) || value <= 0) return "0";
    if (value < 100) return fmt1trim.format(value);
    return fmtInt.format(Math.round(value));
  }

  function daysUnit(value) {
    if (!Number.isFinite(value) || value <= 0) return "дней";
    if (value < 1) return "дня";
    if (value < 2) return Number.isInteger(value) ? "день" : "дня";
    if (value < 5) return "дня";
    return "дней";
  }

  function formatTokens(value) {
    if (!Number.isFinite(value) || value <= 0) return "0";
    if (value >= 1e9) return fmt1.format(value / 1e9) + " млрд";
    if (value >= 1e6) return fmt1.format(value / 1e6) + " млн";
    if (value >= 1e3) return fmtInt.format(value / 1e3) + " тыс.";
    return fmtInt.format(value);
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) return "0,00";
    return fmt2.format(value);
  }

  function priceFor(kind) {
    const pair = PRICES[state.model][kind];
    if (state.tariff === "peak") return pair[0];
    if (state.tariff === "off") return pair[1];
    return (pair[0] + pair[1]) / 2;
  }

  function budgetUsd() {
    const gross = state.kzt / Math.max(1, state.rate);
    return gross / (1 + state.vat / 100) * (1 - state.bank / 100);
  }

  function costOf(inputTokens, outputTokens, cached = 0) {
    return (
      inputTokens * (1 - cached) * priceFor("miss") +
      inputTokens * cached * priceFor("hit") +
      outputTokens * priceFor("out")
    ) / 1_000_000;
  }

  function scenarioCost(scenario) {
    return (scenario.ctx * (1 - scenario.cached) * priceFor("miss") +
      scenario.ctx * scenario.cached * priceFor("hit") +
      scenario.out * priceFor("out")) / 1_000_000 * scenario.req;
  }

  // --------------------------- number animation -------------------------

  const running = new WeakMap();

  function setNumber(el, to, format) {
    if (!el) return;
    const target = Number.isFinite(to) ? Math.max(0, to) : 0;
    const from = Number(el.dataset.value ?? 0);

    if (reduceMotion) {
      el.textContent = format(target);
      el.dataset.value = String(target);
      return;
    }

    if (running.has(el)) cancelAnimationFrame(running.get(el));
    const start = performance.now();
    const duration = 460;

    const step = (now) => {
      const p = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(from + (target - from) * eased);
      if (p < 1) {
        running.set(el, requestAnimationFrame(step));
      } else {
        el.textContent = format(target);
        el.dataset.value = String(target);
        running.delete(el);
      }
    };
    running.set(el, requestAnimationFrame(step));
  }

  // ------------------------------- render -------------------------------

  function setPressed(selector, activeValue, attr) {
    $$(selector).forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset[attr] === activeValue));
    });
  }

  function render() {
    const budget = Math.max(0, budgetUsd());
    const gross = state.kzt / Math.max(1, state.rate);
    const fees = Math.max(0, gross - budget);

    // Receipt
    $("[data-paid]").textContent = fmtInt.format(Math.round(state.kzt)) + " ₸";
    $("[data-rate-line]").textContent = fmt2.format(state.rate) + " ₸/$";
    $("[data-fees]").textContent = "−$" + formatMoney(fees);
    setNumber($("[data-balance]"), budget, formatMoney);

    setNumber($("[data-out-tokens]"), budget / priceFor("out") * 1_000_000, formatTokens);
    setNumber($("[data-miss-tokens]"), budget / priceFor("miss") * 1_000_000, formatTokens);
    setNumber($("[data-hit-tokens]"), budget / priceFor("hit") * 1_000_000, formatTokens);

    const scenario = SCENARIOS[state.scenario];
    const perDay = scenarioCost(scenario);
    const days = perDay > 0 ? budget / perDay : 0;

    setNumber($("[data-days]"), days, formatDays);
    $("[data-days-unit]").textContent = daysUnit(days);
    setNumber($("[data-days-big]"), days, formatDays);
    $("[data-days-big-unit]").textContent = daysUnit(days);
    $("[data-scenario-name]").textContent = scenario.name;
    $("[data-cpd]").textContent = formatMoney(perDay);
    $("[data-req]").textContent = fmtInt.format(scenario.req);
    $("[data-ctx]").textContent = formatTokens(scenario.ctx);

    const modelName = state.model === "pro" ? "V4 Pro" : "Flash";
    const tariffName = state.tariff === "peak" ? "пик" : state.tariff === "off" ? "офф-пик" : "микс";
    $("[data-mode-line]").textContent = "OpenCode · " + modelName + " · " + tariffName + " · " + scenario.name;

    $("[data-stamp]").textContent = fmtInt.format(Math.round(state.kzt));
    $("[data-hero-amount]").textContent = fmtInt.format(Math.round(state.kzt)) + " ₸";
    document.title = fmtInt.format(Math.round(state.kzt)) + " ₸ в DeepSeek — это сколько? Калькулятор";

    // Comparisons
    ITEMS.forEach((item) => {
      const cost = costOf(item.input, item.output, item.cached);
      const count = cost > 0 ? budget / cost : 0;
      setNumber($(`[data-count="${item.id}"]`), count, formatCount);
      const unit = $(`[data-unit="${item.id}"]`);
      if (unit) unit.textContent = countUnit(count, item.forms);
    });

    // Hero facts
    setNumber($("[data-fact-tokens]"), budget / priceFor("out") * 1_000_000, formatTokens);
    const bookCost = costOf(60000, 360000, 0);
    const bookCount = bookCost > 0 ? budget / bookCost : 0;
    setNumber($("[data-fact-books]"), bookCount, formatCount);
    $("[data-fact-books-unit]").textContent = countUnit(bookCount, ["книга", "книги", "книг"]) + " по 300 страниц";
    setNumber($("[data-fact-days]"), days, formatDays);
    $("[data-fact-days-unit]").textContent = daysUnit(days) + " в OpenCode";

    // Verdict: always all three modes, independent of the selected scenario
    const lightDays = budget / Math.max(1e-9, scenarioCost(SCENARIOS.light));
    const normalDays = budget / Math.max(1e-9, scenarioCost(SCENARIOS.normal));
    const heavyDays = budget / Math.max(1e-9, scenarioCost(SCENARIOS.heavy));

    setNumber($("[data-verdict-normal]"), normalDays, formatDays);
    setNumber($("[data-verdict-light]"), lightDays, formatDays);
    setNumber($("[data-verdict-heavy]"), heavyDays, formatDays);
    setNumber($("[data-verdict-row-normal]"), normalDays, formatDays);
    setNumber($("[data-verdict-row-light]"), lightDays, formatDays);
    setNumber($("[data-verdict-row-heavy]"), heavyDays, formatDays);

    $("[data-verdict-normal-unit]").textContent = daysUnit(normalDays);
    $("[data-verdict-light-unit]").textContent = daysUnit(lightDays);
    $("[data-verdict-heavy-unit]").textContent = daysUnit(heavyDays);
    $("[data-verdict-row-normal-unit]").textContent = daysUnit(normalDays);
    $("[data-verdict-row-light-unit]").textContent = daysUnit(lightDays);
    $("[data-verdict-row-heavy-unit]").textContent = daysUnit(heavyDays);

    // Day strip
    const filled = Math.min(30, Math.max(0, days));
    const whole = Math.floor(filled);
    const fraction = filled - whole;
    stripCells.forEach((cell, index) => {
      cell.className = "day-cell";
      if (index < whole) cell.classList.add("on");
      else if (index === whole && fraction > 0.05 && whole < 30) cell.classList.add("part");
    });
    $("[data-strip-label]").textContent = days >= 30
      ? "30 из 30 дней покрыты"
      : formatDays(days) + " из 30 дней";

    // Preset state
    $$(".chip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(Number(chip.dataset.amount) === Math.round(state.kzt)));
    });

    // Minimum top-up hint
    const minKzt = 2 * state.rate * (1 + state.vat / 100) / (1 - state.bank / 100);
    if (state.kzt < minKzt) {
      hint.classList.add("is-error");
      hint.textContent = "Минимум DeepSeek — $2. Это около " + fmtInt.format(Math.ceil(minKzt)) + " ₸ с налогом.";
    } else {
      hint.classList.remove("is-error");
      hint.textContent = "Минимум DeepSeek — $2. Сумма ниже не пройдёт.";
    }

    syncUrl();
  }

  // ------------------------------ bindings ------------------------------

  function setAmount(value, updateInput = true) {
    state.kzt = clamp(Math.round(Number(value) || 0), 0, 1_000_000_000);
    if (updateInput) amountInput.value = state.kzt ? fmtInt.format(state.kzt) : "";
    render();
  }

  amountInput.addEventListener("input", (event) => {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 10);
    const value = digits ? Number(digits) : 0;
    state.kzt = clamp(value, 0, 1_000_000_000);
    event.target.value = digits ? fmtInt.format(state.kzt) : "";
    render();
  });

  amountInput.addEventListener("blur", () => {
    if (state.kzt < 1) setAmount(DEFAULTS.kzt);
    else amountInput.value = fmtInt.format(state.kzt);
  });

  $$(".chip").forEach((chip) => {
    chip.addEventListener("click", () => setAmount(Number(chip.dataset.amount)));
  });

  $$("[data-model]").forEach((button) => {
    button.addEventListener("click", () => {
      state.model = button.dataset.model;
      setPressed("[data-model]", state.model, "model");
      render();
    });
  });

  $$("[data-tariff]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tariff = button.dataset.tariff;
      setPressed("[data-tariff]", state.tariff, "tariff");
      render();
    });
  });

  $$("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      state.scenario = button.dataset.scenario;
      setPressed("[data-scenario]", state.scenario, "scenario");
      render();
    });
  });

  function bindAdvanced(input, key, min, max) {
    input.addEventListener("input", () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      state[key] = clamp(value, min, max);
      render();
    });
    input.addEventListener("blur", () => {
      input.value = String(state[key]);
    });
  }

  bindAdvanced(rateInput, "rate", 1, 2000);
  bindAdvanced(vatInput, "vat", 0, 50);
  bindAdvanced(bankInput, "bank", 0, 20);

  $("#reset").addEventListener("click", () => {
    state.rate = DEFAULTS.rate;
    state.vat = DEFAULTS.vat;
    state.bank = DEFAULTS.bank;
    rateInput.value = String(DEFAULTS.rate);
    vatInput.value = String(DEFAULTS.vat);
    bankInput.value = String(DEFAULTS.bank);
    render();
  });

  copyButton.addEventListener("click", async () => {
    const budget = budgetUsd();
    const bookCost = costOf(60000, 360000, 0);
    const bookCount = budget / bookCost;
    const podcastCost = costOf(25000, 1500, 0);
    const podcastCount = budget / podcastCost;
    const days = budget / scenarioCost(SCENARIOS[state.scenario]);
    const text = [
      fmtInt.format(Math.round(state.kzt)) + " ₸ → $" + formatMoney(budget) + " на балансе DeepSeek",
      formatCount(bookCount) + " " + countUnit(bookCount, ["книга", "книги", "книг"]) + " по 300 страниц",
      formatCount(podcastCount) + " " + countUnit(podcastCount, ["эпизод", "эпизода", "эпизодов"]) + " подкастов",
      formatDays(days) + " " + daysUnit(days) + " в OpenCode",
      "",
      location.href,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = "Скопировано";
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      copyButton.textContent = "Скопировано";
    }

    window.setTimeout(() => { copyButton.textContent = "Скопировать"; }, 1600);
  });

  // ------------------------------- URL ----------------------------------

  function syncUrl() {
    const params = new URLSearchParams();
    params.set("amount", String(Math.round(state.kzt)));
    params.set("model", state.model);
    params.set("tariff", state.tariff);
    params.set("scenario", state.scenario);
    const next = location.pathname + "?" + params.toString();
    if (location.search !== "?" + params.toString()) {
      history.replaceState(null, "", next);
    }
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    const amount = Number(params.get("amount"));
    if (Number.isFinite(amount) && amount > 0) state.kzt = clamp(Math.round(amount), 0, 1_000_000_000);
    if (["flash", "pro"].includes(params.get("model"))) state.model = params.get("model");
    if (["peak", "mix", "off"].includes(params.get("tariff"))) state.tariff = params.get("tariff");
    if (["light", "normal", "heavy"].includes(params.get("scenario"))) state.scenario = params.get("scenario");
  }

  // ------------------------------- start --------------------------------

  readUrl();
  amountInput.value = fmtInt.format(state.kzt);
  setPressed("[data-model]", state.model, "model");
  setPressed("[data-tariff]", state.tariff, "tariff");
  setPressed("[data-scenario]", state.scenario, "scenario");
  render();
})();

import { openingCash, closingCash, realized, events } from "./finance.js";
const $ = (s) => document.querySelector(s),
  money = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Math.abs(n) < 0.005 ? 0 : n),
  signed = (n) => (n > 0 ? "+" : "") + money(n),
  color = (n) => (n < 0 ? "negative" : "positive");
const labels = {
  sell_put: "Sell put",
  sell_call: "Sell call",
  buy_put: "Buy put",
};
const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const displayDate = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
let trades = [],
  revision = 0,
  user = null,
  status = "all",
  closingId = null,
  saving = false;
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Chai-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await r.json();
  if (r.status === 401) {
    location.replace("/login");
    throw new Error("Please sign in.");
  }
  if (!r.ok) throw new Error(result.error || "Request failed.");
  return result;
}
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").style.display = "none"), 4500);
}
async function persist(next) {
  if (saving) throw new Error("Another save is in progress. Please try again.");
  saving = true;
  $("#save-state").textContent = "● Saving…";
  try {
    const saved = await api("trades", { trades: next, revision });
    revision = saved.revision;
    trades = next;
    render();
    $("#save-state").textContent = "● Saved to your account";
  } catch (e) {
    $("#save-state").textContent = "● Changes not saved";
    throw e;
  } finally {
    saving = false;
  }
}
const inPeriod = (d) =>
  (!$("#from").value || d >= $("#from").value) &&
  (!$("#to").value || d <= $("#to").value);
function setPeriod(period) {
  const d = today();
  $("#to").value = period === "all" ? "" : d;
  $("#from").value =
    period === "month" ? d.slice(0, 7) + "-01" : period === "today" ? d : "";
  $("#period-tabs")
    .querySelectorAll("button")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.period === period),
    );
  render();
}
function render() {
  const strategy = $("#strategy-filter").value,
    selected = trades.filter(
      (t) => strategy === "all" || t.strategy === strategy,
    ),
    cashEvents = events(selected).filter((e) => inPeriod(e.date)),
    closed = selected.filter((t) => t.close && inPeriod(t.close.date));
  const pnl = closed.reduce((n, t) => n + realized(t), 0),
    collected = cashEvents
      .filter((e) => e.kind === "open" && e.trade.strategy !== "buy_put")
      .reduce(
        (n, e) => n + e.trade.premium * e.trade.quantity * e.trade.multiplier,
        0,
      );
  const paid = cashEvents.reduce(
    (n, e) =>
      n +
      (e.kind === "open"
        ? (e.trade.strategy === "buy_put"
            ? e.trade.premium * e.trade.quantity * e.trade.multiplier
            : 0) + e.trade.fees
        : (e.trade.strategy !== "buy_put"
            ? e.trade.close.premium * e.trade.quantity * e.trade.multiplier
            : 0) + e.trade.close.fees),
    0,
  );
  $("#net").textContent = signed(pnl);
  $("#net-foot").textContent =
    `${money(closed.reduce((n, t) => n + Math.max(0, realized(t)), 0))} gains · ${money(-closed.reduce((n, t) => n + Math.min(0, realized(t)), 0))} losses`;
  $("#collected").textContent = money(collected);
  $("#paid").textContent = money(paid);
  $("#open").textContent = selected.filter((t) => !t.close).length;
  $("#open-foot").textContent = "Current positions · all dates";
  $("#strategies").innerHTML = Object.entries(labels)
    .map(([key, label]) => {
      const list = closed.filter((t) => t.strategy === key),
        sum = list.reduce((n, t) => n + realized(t), 0);
      return `<div class="strategy-row"><span class="strategy-icon ${key === "sell_call" ? "call" : key === "buy_put" ? "buy" : ""}">${key === "buy_put" ? "↗" : "↙"}</span><div><strong>${label}</strong><small>${list.length} closed position${list.length === 1 ? "" : "s"}</small></div><div class="amount ${sum === 0 ? "" : color(sum)}">${signed(sum)}</div></div>`;
    })
    .join("");
  $("#win-rate").textContent = closed.length
    ? Math.round(
        (closed.filter((t) => realized(t) > 0).length / closed.length) * 100,
      ) + "%"
    : "—";
  const search = $("#search").value.trim().toUpperCase();
  const visible = selected
    .filter(
      (t) =>
        (inPeriod(t.date) || (t.close && inPeriod(t.close.date))) &&
        (status === "all" || (status === "open" ? !t.close : !!t.close)) &&
        t.symbol.includes(search),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#position-count").textContent = visible.length;
  $("#showing").textContent = `${visible.length} of ${trades.length} positions`;
  $("#empty").hidden = visible.length > 0;
  $("#trade-rows").innerHTML = visible
    .map(
      (t) =>
        `<tr><td><strong>${escape(t.symbol)}</strong><small>${labels[t.strategy]} · ${displayDate(t.date)}</small></td><td>${money(t.strike)}<small>${displayDate(t.expiry)}</small></td><td>${t.quantity}<small>× ${t.multiplier} shares</small></td><td>${money(t.premium * t.quantity * t.multiplier)}<small>${money(t.premium)} / share · ${t.strategy === "buy_put" ? "paid" : "received"}</small></td><td><span class="badge ${t.close ? "closed" : ""}">${t.close ? "Closed" : "Open"}</span></td><td class="${t.close ? color(realized(t)) : ""}">${t.close ? signed(realized(t)) : "—"}</td><td><button class="row-button" data-detail="${t.id}">Details</button> ${t.close ? "" : `<button class="row-button" data-close="${t.id}">Close ↗</button>`}</td></tr>`,
    )
    .join("");
  const days = {};
  for (const e of cashEvents) {
    days[e.date] ??= { incoming: 0, outgoing: 0, pnl: 0, gains: 0, losses: 0 };
    days[e.date][e.amount >= 0 ? "incoming" : "outgoing"] += Math.abs(e.amount);
  }
  for (const t of closed) {
    days[t.close.date] ??= {
      incoming: 0,
      outgoing: 0,
      pnl: 0,
      gains: 0,
      losses: 0,
    };
    days[t.close.date].pnl += realized(t);
    days[t.close.date].gains += Math.max(0, realized(t));
    days[t.close.date].losses += Math.max(0, -realized(t));
  }
  $("#daily-rows").innerHTML =
    Object.entries(days)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(
        ([date, d]) =>
          `<tr><td>${displayDate(date)}</td><td class="positive">${money(d.incoming)}</td><td>${money(d.outgoing)}</td><td class="${color(d.incoming - d.outgoing)}">${signed(d.incoming - d.outgoing)}</td><td class="positive">${money(d.gains)}</td><td class="negative">${money(d.losses)}</td><td class="${color(d.pnl)}">${signed(d.pnl)}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="7">No cash activity in this period. Log a trade to get started.</td></tr>';
  renderChart(days);
}
function renderChart(days) {
  const entries = Object.entries(days).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) {
    $("#chart").innerHTML =
      '<div class="chart-empty"><strong>Make room for your progress.</strong><span>Your cash flow will appear as you log trades.</span></div>';
    return;
  }
  let cumulative = 0;
  const values = [
      0,
      ...entries.map(([, d]) => (cumulative += d.incoming - d.outgoing)),
    ],
    min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || 1;
  const x = (i) => 62 + (i / (values.length - 1)) * 565,
    y = (v) => 153 - ((v - min) / range) * 130;
  const line = values
      .map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`)
      .join(" "),
    area = line + ` L627,165 L62,165 Z`;
  $("#chart").innerHTML =
    `<svg viewBox="0 0 650 200" role="img" aria-label="Cumulative cash flow for the selected period ending at ${escape(money(cumulative))}"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d6e9d8" stop-opacity="0.6"/><stop offset="100%" stop-color="#f7faf6" stop-opacity="0.2"/></linearGradient></defs>${[
      0, 1, 2, 3,
    ]
      .map((i) => {
        const v = max - (range * i) / 3;
        return `<line x1="62" x2="627" y1="${y(v)}" y2="${y(v)}" stroke="#edf2ec" stroke-dasharray="3 4"/><text x="2" y="${y(v) + 3}" font-size="9" fill="#9aa99d">${escape(money(v))}</text>`;
      })
      .join(
        "",
      )}<path d="${area}" fill="url(#chart-fill)"/><path d="${line}" fill="none" stroke="#659676" stroke-width="2.5" stroke-linejoin="round"/>${values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#659676"><title>${i ? displayDate(entries[i - 1][0]) : "Period start"}: ${money(v)}</title></circle>`).join("")}<text x="62" y="190" fill="#9aa99d" font-size="9">${displayDate(entries[0][0])}</text><text x="627" y="190" text-anchor="end" fill="#9aa99d" font-size="9">${displayDate(entries.at(-1)[0])}</text></svg>`;
}
function showTrade() {
  const f = $("#trade-form");
  f.reset();
  f.elements.date.value = today();
  f.elements.expiry.min = today();
  $("#trade-dialog").showModal();
  previewOpen();
}
function formTrade() {
  const data = Object.fromEntries(new FormData($("#trade-form")));
  for (const k of ["strike", "quantity", "premium", "fees", "multiplier"])
    data[k] = Number(data[k]);
  data.symbol = data.symbol.trim().toUpperCase();
  return data;
}
function previewOpen() {
  const t = formTrade(),
    amount = openingCash(t);
  $("#open-preview").textContent =
    `Opening cash ${amount >= 0 ? "received" : "paid"}: ${money(Math.abs(amount))} (${t.quantity || 0} × ${t.multiplier || 0} × ${money(t.premium || 0)}, less fees)`;
}
$("#trade-form").addEventListener("input", () => {
  const f = $("#trade-form");
  f.elements.expiry.min = f.elements.date.value;
  previewOpen();
});
$("#trade-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = formTrade();
  if (t.expiry < t.date)
    return toast("Expiration must be on or after the trade date.");
  const button = e.submitter;
  button.disabled = true;
  try {
    await persist([...trades, { ...t, id: crypto.randomUUID() }]);
    $("#trade-dialog").close();
    toast("Trade added to your journal.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
function showClose(id) {
  const t = trades.find((t) => t.id === id);
  closingId = id;
  const f = $("#close-form");
  f.reset();
  f.elements.date.value = today() < t.date ? t.date : today();
  f.elements.date.min = t.date;
  f.elements.premium.value = "";
  $("#close-title").textContent =
    `Close ${t.symbol} ${labels[t.strategy].toLowerCase()}`;
  $("#close-description").textContent =
    `${t.quantity} contract${t.quantity === 1 ? "" : "s"} · ${money(t.strike)} strike · ${money(t.premium)} opening premium per share. Enter ${t.strategy === "buy_put" ? "the premium received when selling" : "the premium paid to buy back"} this option.`;
  $("#close-dialog").showModal();
  previewClose();
}
function previewClose() {
  const t = trades.find((t) => t.id === closingId);
  if (!t) return;
  const close = Object.fromEntries(new FormData($("#close-form")));
  close.premium = Number(close.premium);
  close.fees = Number(close.fees);
  $("#close-preview").textContent =
    `Realized P&L after fees: ${signed(realized({ ...t, close }))}`;
}
$("#close-form").addEventListener("input", previewClose);
$("#close-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = $("#close-form"),
    close = {
      date: f.elements.date.value,
      premium: Number(f.elements.premium.value),
      fees: Number(f.elements.fees.value),
    };
  const button = e.submitter;
  button.disabled = true;
  try {
    await persist(
      trades.map((t) => (t.id === closingId ? { ...t, close } : t)),
    );
    $("#close-dialog").close();
    toast("Position closed. Your results are updated.");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
function details(id) {
  const t = trades.find((t) => t.id === id);
  const fields = {
    Opened: displayDate(t.date),
    Expiration: displayDate(t.expiry),
    Strike: money(t.strike),
    Contracts: `${t.quantity} × ${t.multiplier} shares`,
    "Opening premium / share": money(t.premium),
    "Opening fees": money(t.fees),
    "Opening net cash": signed(openingCash(t)),
    ...(t.close
      ? {
          Closed: displayDate(t.close.date),
          "Closing premium / share": money(t.close.premium),
          "Closing fees": money(t.close.fees),
          "Closing net cash": signed(closingCash(t)),
          "Realized P&L": signed(realized(t)),
        }
      : { Status: "Open · unrealized profit not tracked" }),
  };
  $("#detail-content").innerHTML =
    `<div class="modal-heading"><h2>${escape(t.symbol)} · ${labels[t.strategy]}</h2><button class="icon-button" id="detail-dismiss" aria-label="Close">×</button></div><div class="detail-list">${Object.entries(
      fields,
    )
      .map(([k, v]) => `<div><small>${k}</small>${escape(v)}</div>`)
      .join(
        "",
      )}</div><p class="hint">${escape(t.notes || "No notes for this trade.")}</p><div class="modal-actions"><button class="button secondary danger" id="delete-trade">Delete trade</button>${t.close ? '<button class="button secondary" id="reopen-trade">Undo close</button>' : '<button class="button primary" id="detail-close">Close position</button>'}</div>`;
  $("#detail-dialog").showModal();
  $("#detail-dismiss").onclick = () => $("#detail-dialog").close();
  $("#delete-trade").onclick = async () => {
    if (
      !confirm(
        `Delete ${t.symbol} and all its cash activity? This cannot be undone.`,
      )
    )
      return;
    try {
      await persist(trades.filter((a) => a.id !== id));
      $("#detail-dialog").close();
      toast("Trade deleted.");
    } catch (e) {
      toast(e.message);
    }
  };
  if (t.close)
    $("#reopen-trade").onclick = async () => {
      if (!confirm("Remove the closing transaction and reopen this position?"))
        return;
      try {
        await persist(
          trades.map((a) => (a.id === id ? { ...a, close: null } : a)),
        );
        $("#detail-dialog").close();
        toast("Position reopened.");
      } catch (e) {
        toast(e.message);
      }
    };
  else
    $("#detail-close").onclick = () => {
      $("#detail-dialog").close();
      showClose(id);
    };
}
$("#trade-rows").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b?.dataset.close) showClose(b.dataset.close);
  if (b?.dataset.detail) details(b.dataset.detail);
});
for (const id of ["#add-trade", "#empty-add"]) $(id).onclick = showTrade;
document
  .querySelectorAll(".dismiss")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
$("#period-tabs").onclick = (e) => {
  const b = e.target.closest("button");
  if (b) setPeriod(b.dataset.period);
};
for (const id of ["#from", "#to"])
  $(id).addEventListener("change", () => {
    if (
      $("#from").value &&
      $("#to").value &&
      $("#from").value > $("#to").value
    ) {
      toast("Start date must be before end date.");
      return;
    }
    $("#period-tabs")
      .querySelectorAll("button")
      .forEach((b) =>
        b.classList.toggle("selected", b.dataset.period === "custom"),
      );
    render();
  });
$("#status-tabs").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  status = b.dataset.status;
  $("#status-tabs")
    .querySelectorAll("button")
    .forEach((a) => a.classList.toggle("selected", a === b));
  render();
};
$("#search").addEventListener("input", render);
$("#strategy-filter").addEventListener("change", render);
function exportData() {
  const blob = new Blob(
      [
        JSON.stringify(
          { version: 1, exportedAt: new Date().toISOString(), trades },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `${document.body.dataset.appSlug}-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup exported. Keep it in a safe place.");
}
$("#export").onclick = exportData;
$("#export-side").onclick = exportData;
$("#import").onclick = () => $("#import-file").click();
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1500000)
      throw new Error("Backup is too large (maximum 1.5 MB).");
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.trades))
      throw new Error(`Choose a ${document.body.dataset.appName} JSON backup.`);
    if (
      !confirm(
        `Import ${data.trades.length} trades? This replaces all ${trades.length} existing trades. Export a backup first if needed.`,
      )
    )
      return;
    await persist(data.trades);
    toast("Backup imported successfully.");
  } catch (error) {
    toast(error.message);
  } finally {
    e.target.value = "";
  }
});
$("#help").onclick = () => {
  $("#detail-content").innerHTML =
    '<div class="modal-heading"><h2>Understand your results</h2><button class="icon-button" id="help-dismiss" aria-label="Close">×</button></div><p class="modal-description">For sold puts and calls: realized profit = opening premium received − buyback premium paid − all fees.<br><br>For bought puts: realized profit = closing premium received − opening premium paid − all fees.<br><br>Each premium is per share, multiplied by your contracts and contract multiplier (usually 100). Realized profit is counted on the closing date. Cash flow is counted on each transaction date.<br><br>Open positions are not included in realized profit. This journal does not fetch market prices or broker trades. Assignments, exercise, stock transactions and partial closes are not supported. Record full option closes manually.<br><br>All amounts are USD. Dates follow your device’s local date. Export backups regularly.</p>';
  $("#detail-dialog").showModal();
  $("#help-dismiss").onclick = () => $("#detail-dialog").close();
};
$("#logout").onclick = async () => {
  try {
    await api("logout", {});
    location.href = "/login";
  } catch (e) {
    toast(e.message);
  }
};
function showPassword() {
  $("#password-form").reset();
  $("#password-error").textContent = "";
  $("#password-description").textContent = user.mustChange
    ? "Change your temporary password before accessing your journal. Choose at least 12 characters."
    : "Choose a password of at least 12 characters. Other sessions will be signed out.";
  $("#password-cancel").hidden = user.mustChange;
  $("#password-dialog").showModal();
}
$("#change-password").onclick = showPassword;
$("#password-cancel").onclick = () => $("#password-dialog").close();
$("#password-dialog").addEventListener("cancel", (e) => {
  if (user.mustChange) e.preventDefault();
});
$("#password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.elements.password.value !== f.elements.confirm.value) {
    $("#password-error").textContent = "New passwords do not match.";
    return;
  }
  e.submitter.disabled = true;
  try {
    await api("password", {
      current: f.elements.current.value,
      password: f.elements.password.value,
    });
    user.mustChange = false;
    $("#password-dialog").close();
    toast("Password updated.");
    const loaded = await api("trades");
    trades = loaded.trades;
    revision = loaded.revision;
    render();
  } catch (error) {
    $("#password-error").textContent = error.message;
  } finally {
    e.submitter.disabled = false;
  }
});
async function initialize() {
  try {
    user = await api("me");
    $(".profile div").innerHTML =
      `My portfolio<small>${escape(user.email)}</small>`;
    setPeriod("month");
    if (user.mustChange) {
      showPassword();
      return;
    }
    const loaded = await api("trades");
    trades = loaded.trades;
    revision = loaded.revision;
    render();
  } catch (error) {
    if (!user) return;
    toast(error.message);
    $("#save-state").textContent = "● Could not load records";
  }
}
initialize();

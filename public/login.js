const form = document.querySelector("#login-form");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  const error = document.querySelector("#login-error");
  error.textContent = "";
  try {
    const data = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chai-Request": "1" },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    location.href = "/";
  } catch (e) {
    error.textContent = e.message;
  } finally {
    button.disabled = false;
  }
});

(() => {
  const status = document.getElementById("offline-status");
  let waitingUpdate = false;
  const updateStatus = () => {
    if (status) status.textContent = waitingUpdate ? "新版已備妥，關閉遊戲頁面後重新開啟即可更新。"
      : navigator.onLine ? "" : "離線模式 · 未快取語音與線上對戰需連網";
  };
  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);
  updateStatus();
  const button = document.getElementById("btn-install");
  let installPrompt;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); installPrompt = event;
    if (button) button.hidden = false;
  });
  button?.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt; installPrompt = null; button.hidden = true;
    await prompt.prompt();
  });
  window.addEventListener("appinstalled", () => { installPrompt = null; if (button) button.hidden = true; });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").then((registration) => {
      const showUpdate = () => { waitingUpdate = !!registration.waiting; updateStatus(); };
      showUpdate();
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", showUpdate);
      });
    }).catch(() => {
      if (status) status.textContent = "離線快取尚未建立；目前可在線上使用。";
    });
  }
})();

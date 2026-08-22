let removeSystemThemeListener: (() => void) | null = null;
let transitionFrame = 0;

function suppressThemeTransition(root: HTMLElement) {
  root.classList.add("theme-switching");
  if (transitionFrame) window.cancelAnimationFrame(transitionFrame);
  transitionFrame = window.requestAnimationFrame(() => {
    transitionFrame = window.requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
      transitionFrame = 0;
    });
  });
}

/** 应用主题到 document.documentElement */
export function applyTheme(theme: string) {
  const root = document.documentElement;
  suppressThemeTransition(root);
  removeSystemThemeListener?.();
  removeSystemThemeListener = null;
  root.classList.remove(
    "theme-light", "theme-dark", "theme-fu", "theme-grace",
    "theme-sui", "theme-zhi", "theme-azure", "theme-azure-dark"
  );

  if (theme === "system") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystem = () => {
      root.classList.remove("theme-light", "theme-dark");
      root.classList.add(mq.matches ? "theme-dark" : "theme-light");
    };
    applySystem();
    mq.addEventListener("change", applySystem);
    removeSystemThemeListener = () => mq.removeEventListener("change", applySystem);
    return;
  }

  if (theme === "light") {
    root.classList.add("theme-light");
  } else if (theme === "dark") {
    root.classList.add("theme-dark");
  } else if (theme === "fu") {
    root.classList.add("theme-fu");
  } else if (theme === "grace") {
    root.classList.add("theme-grace");
  } else if (theme === "sui") {
    root.classList.add("theme-sui");
  } else if (theme === "zhi") {
    root.classList.add("theme-zhi");
  } else if (theme === "azure") {
    root.classList.add("theme-azure");
  } else if (theme === "azure-dark") {
    root.classList.add("theme-azure-dark");
  }
}

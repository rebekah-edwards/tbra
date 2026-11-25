"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Android Chrome offers a real install prompt for the PWA; when it has fired
 * we use it. Otherwise (another browser, or already installed) we say where
 * the browser keeps "Install app".
 */
export function InstallWebAppButton({ primary }: { primary: boolean }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return <p className="text-sm text-foreground">Installed. Open tbr*a from your home screen.</p>;
  }

  const onClick = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setPromptEvent(null);
    } else {
      setShowHelp(true);
    }
  };

  return (
    <div className="w-full">
      <button type="button" onClick={onClick} className={`${primary ? "btn-lime" : "btn-glass"} px-5 py-2 text-sm`}>
        Install the app
      </button>
      {showHelp && (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          In Chrome, open the <strong className="text-foreground">⋮</strong> menu and choose{" "}
          <strong className="text-foreground">Install app</strong> (or{" "}
          <strong className="text-foreground">Add to Home screen</strong>). On an iPhone, use Safari&apos;s
          Share button, then <strong className="text-foreground">Add to Home Screen</strong>.
        </p>
      )}
    </div>
  );
}

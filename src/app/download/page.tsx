import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  TESTFLIGHT_URL,
  detectPlatform,
  getStoreAvailability,
} from "@/lib/app-links";
import { InstallWebAppButton } from "./install-web-app-button";

export const metadata: Metadata = {
  title: "Get the App | The Based Reader App",
  description:
    "Get tbr*a on iPhone and Android: track your reading, set your content comfort zone, and see what's inside a book before you read it.",
  alternates: { canonical: "https://thebasedreader.app/download" },
};

function StoreCard({
  eyebrow,
  title,
  body,
  children,
  highlight,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <section className={`${highlight ? "card-hairline" : "rounded-[22px] border border-foreground/10 bg-surface/60"} p-5`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-1 font-heading text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
      <div className="mt-4 flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

export default async function DownloadPage() {
  const [hdrs, stores] = await Promise.all([headers(), getStoreAvailability()]);
  const platform = detectPlatform(hdrs.get("user-agent") ?? "");

  const iosCard = (
    <StoreCard
      key="ios"
      eyebrow="iPhone"
      title={stores.ios ? "Download on the App Store" : "Coming soon to the App Store"}
      body={
        stores.ios
          ? "The native iPhone app, with widgets and Sign in with Apple."
          : "The iPhone app is in Apple's review queue. Until it's out, you can join the beta through TestFlight."
      }
      highlight={platform === "ios"}
    >
      {stores.ios ? (
        <a href={APP_STORE_URL} className="btn-lime px-5 py-2 text-sm" target="_blank" rel="noopener noreferrer">
          Open the App Store
        </a>
      ) : (
        <a href={TESTFLIGHT_URL} className={`${platform === "ios" ? "btn-lime" : "btn-glass"} px-5 py-2 text-sm`} target="_blank" rel="noopener noreferrer">
          Join the iPhone beta
        </a>
      )}
    </StoreCard>
  );

  const androidCard = (
    <StoreCard
      key="android"
      eyebrow="Android"
      title={stores.android ? "Get it on Google Play" : "Install tbr*a on Android"}
      body={
        stores.android
          ? "The tbr*a app for Android phones and tablets."
          : "The Play Store listing is on its way. Meanwhile, install tbr*a straight from your browser: it runs full screen with its own icon, just like an app."
      }
      highlight={platform === "android"}
    >
      {stores.android ? (
        <a href={PLAY_STORE_URL} className="btn-lime px-5 py-2 text-sm" target="_blank" rel="noopener noreferrer">
          Open Google Play
        </a>
      ) : (
        <InstallWebAppButton primary={platform === "android"} />
      )}
    </StoreCard>
  );

  // The visitor's own device first.
  const cards = platform === "android" ? [androidCard, iosCard] : [iosCard, androidCard];

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex flex-col items-center text-center">
        <Image src="/icons/icon-192.png" alt="tbr*a app icon" width={72} height={72} className="h-[72px] w-[72px] rounded-[18px] shadow-lg" priority />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Get the tbr*a app</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Know what&apos;s in a book before you read it. Track your reading, set your
          comfort zone, and get flagged when a book crosses it.
        </p>
      </div>
      <div className="mt-8 space-y-4">{cards}</div>
      <p className="mt-6 text-center text-xs text-muted/70">
        On a computer? Everything works right here at thebasedreader.app.
      </p>
    </div>
  );
}

import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

async function getFont() {
  const res = await fetch(
    "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap"
  );
  const css = await res.text();
  const fontUrl = css.match(
    /src: url\((.+?)\) format\('(woff2|truetype)'\)/
  )?.[1];
  if (!fontUrl) throw new Error("Could not find Space Grotesk font URL");
  const fontRes = await fetch(fontUrl);
  return fontRes.arrayBuffer();
}

export default async function AppleIcon() {
  const fontData = await getFont();

  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontSize: 310,
            fontFamily: "Space Grotesk",
            fontWeight: 700,
            lineHeight: 1,
            background: "linear-gradient(135deg, #a3e635 0%, #38bdf8 50%, #c084fc 100%)",
            backgroundClip: "text",
            color: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 70,
          }}
        >
          *
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Space Grotesk",
          data: fontData,
          style: "normal",
          weight: 700,
        },
      ],
    }
  );
}

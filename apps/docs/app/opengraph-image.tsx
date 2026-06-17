import { ImageResponse } from "next/og";

export const alt = "Ori — a virtualized note editor";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Generated at build time. Uses next/og's bundled default font (no network).
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0f1310",
          color: "#e7ece0",
          padding: "78px 84px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 22,
            letterSpacing: 5,
            color: "#8c9a86",
          }}
        >
          <div style={{ width: 48, height: 3, background: "#46cf8d", borderRadius: 2 }} />
          LOCAL-FIRST · TEXT LAYOUT ENGINE
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 78,
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: -2,
          }}
        >
          <div style={{ display: "flex" }}>A virtualized note editor —</div>
          <div style={{ display: "flex" }}>
            <span style={{ color: "#46cf8d" }}>layout derived</span>
            <span>, never stored.</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
            color: "#8c9a86",
          }}
        >
          <div style={{ display: "flex" }}>@wingleeio/ori-react · @wingleeio/ori-core</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "#e7ece0",
              fontWeight: 600,
            }}
          >
            Ori
            <div style={{ width: 12, height: 12, borderRadius: 99, background: "#46cf8d" }} />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

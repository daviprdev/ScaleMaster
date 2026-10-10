import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const logoPath = path.join(process.cwd(), "public/brand/scale-master-logo.jpg");
  const logoData = fs.readFileSync(logoPath);
  const logoBase64 = logoData.toString("base64");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#001244",
          borderRadius: 36,
        }}
      >
        <img
          src={`data:image/jpeg;base64,${logoBase64}`}
          width={140}
          height={140}
          style={{ objectFit: "contain", borderRadius: 24 }}
        />
      </div>
    ),
    { ...size }
  );
}
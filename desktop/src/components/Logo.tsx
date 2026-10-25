import logo from "@/assets/salli-logo.png";

export function Logo({ size = 40 }: { size?: number }) {
  return <img src={logo} alt="" width={size} height={size} className="flex-none rounded-xl" style={{ width: size, height: size }} />;
}

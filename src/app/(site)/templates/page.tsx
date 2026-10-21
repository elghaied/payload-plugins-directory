import { redirect } from "next/navigation";

export default function TemplatesIndex() {
  redirect("/?type=templates");
}

import { PluginDirectory } from "@/components/PluginDirectory";
import { fetchPlugins } from "@/lib/getPlugins";

 

export default async function Page() {
  const plugins = await fetchPlugins();

  return <PluginDirectory plugins={plugins} />;
}
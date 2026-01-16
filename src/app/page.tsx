import { PluginDirectory } from "@/components/PluginDirectory";
import { getPlugins, getPluginsMetadata } from "@/lib/getPlugins";

export default function Page() {
  const plugins = getPlugins();
  const metadata = getPluginsMetadata();

  return <PluginDirectory plugins={plugins} metadata={metadata} />;
}

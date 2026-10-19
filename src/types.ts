export interface PackageJson {
  name?: string;
  description?: string;
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
  private?: boolean;
}

export interface NpmData {
  weeklyDownloads: number;
  monthlyDownloads: number;
  latestVersion: string;
  unpackedSize: number | null;
  lastPublish: string;
  dependencyCount: number;
}


export type SortOption = "featured" | "stars" | "forks" | "recent" | "created" | "name" | "downloads" | "health";
export type VersionFilter = "all" | "unknown" | "1" | "2" | "3" | "4";

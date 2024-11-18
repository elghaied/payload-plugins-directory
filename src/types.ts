export interface GitHubContent {
    name: string;
    type: "dir" | "file";
    path: string;
  }
  
  export interface GitHubRepo {
    id: number;
    name: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    updated_at: string;
    html_url: string;
    topics: string[];
    owner: {
      login: string;
    };
    default_branch: string;
  }
  
  export interface PackageJson {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    description?: string;
  }
  
  export interface Plugin {
    id: string;
    name: string;
    collection?: string;
    description: string;
    stars: number;
    forks: number;
    lastUpdate: string;
    owner: string;
    url: string;
    topics: string[];
    isOfficial: boolean;
    payloadVersion: string | null;
    payloadVersionMajor: number[] | null;
  }
  
  export type SortOption = "stars" | "forks" | "recent";
  export type VersionFilter = "all" | "1" | "2" | "3";
"use client";

import { useEffect, useState } from "react";
import {
  Star,
  GitFork,
  AlertCircle,
  Clock,
  ExternalLink,
  X,
  Calendar,
  Scale,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plugin } from "../../types";
import { PayloadIcon } from "../PayloadIcon";

const versionColors: Record<number, string> = {
  0: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
  1: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatNumber(num: number): string {
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

function getHealthStatus(plugin: Plugin): { color: string; label: string } {
  if (plugin.isArchived) return { color: "bg-red-500", label: "Archived" };
  const daysSinceUpdate = Math.floor(
    (Date.now() - new Date(plugin.lastUpdate).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysSinceUpdate < 90) return { color: "bg-green-500", label: "Active" };
  if (daysSinceUpdate < 365) return { color: "bg-yellow-500", label: "Moderate" };
  return { color: "bg-orange-500", label: "Stale" };
}

interface ComparisonViewProps {
  plugins: Plugin[];
  onRemove: (id: string) => void;
  onClose: () => void;
}

type ComparisonRow = {
  label: string;
  icon: React.ReactNode;
  render: (plugin: Plugin, isBest: boolean) => React.ReactNode;
  getBest: (plugins: Plugin[]) => Set<string>;
};

export function ComparisonView({ plugins, onRemove, onClose }: ComparisonViewProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 200);
  };

  const rows: ComparisonRow[] = [
    {
      label: "Stars",
      icon: <Star className="h-3.5 w-3.5 text-amber-500" />,
      render: (p, best) => (
        <span className={best ? "text-foreground font-bold" : "text-muted-foreground"}>
          {formatNumber(p.stars)}
        </span>
      ),
      getBest: (ps) => {
        const max = Math.max(...ps.map((p) => p.stars));
        return new Set(ps.filter((p) => p.stars === max).map((p) => p.id));
      },
    },
    {
      label: "Forks",
      icon: <GitFork className="h-3.5 w-3.5 text-blue-500" />,
      render: (p, best) => (
        <span className={best ? "text-foreground font-bold" : "text-muted-foreground"}>
          {formatNumber(p.forks)}
        </span>
      ),
      getBest: (ps) => {
        const max = Math.max(...ps.map((p) => p.forks));
        return new Set(ps.filter((p) => p.forks === max).map((p) => p.id));
      },
    },
    {
      label: "Open Issues",
      icon: <AlertCircle className="h-3.5 w-3.5 text-orange-500" />,
      render: (p, best) => (
        <span className={best ? "text-foreground font-bold" : "text-muted-foreground"}>
          {p.openIssues}
        </span>
      ),
      getBest: (ps) => {
        const min = Math.min(...ps.map((p) => p.openIssues));
        return new Set(ps.filter((p) => p.openIssues === min).map((p) => p.id));
      },
    },
    {
      label: "Version",
      icon: <PayloadIcon className="h-3.5 w-3.5" />,
      render: (p) => (
        <div className="flex gap-1 flex-wrap">
          {p.payloadVersionMajor.map((v) => (
            <Badge
              key={v}
              variant="secondary"
              className={`${versionColors[v] || "bg-gray-100"} text-[10px] px-1.5 py-0`}
            >
              {v === 0 ? "v?" : `v${v}`}
            </Badge>
          ))}
        </div>
      ),
      getBest: () => new Set<string>(),
    },
    {
      label: "License",
      icon: <Scale className="h-3.5 w-3.5 text-muted-foreground" />,
      render: (p) => (
        <span className="text-muted-foreground text-xs">
          {p.license || "None"}
        </span>
      ),
      getBest: () => new Set<string>(),
    },
    {
      label: "Last Updated",
      icon: <Clock className="h-3.5 w-3.5 text-emerald-500" />,
      render: (p, best) => (
        <span className={best ? "text-foreground font-bold" : "text-muted-foreground"}>
          {formatRelativeTime(p.lastUpdate)}
        </span>
      ),
      getBest: (ps) => {
        const max = Math.max(...ps.map((p) => new Date(p.lastUpdate).getTime()));
        return new Set(
          ps.filter((p) => new Date(p.lastUpdate).getTime() === max).map((p) => p.id)
        );
      },
    },
    {
      label: "Created",
      icon: <Calendar className="h-3.5 w-3.5 text-muted-foreground" />,
      render: (p) => (
        <span className="text-muted-foreground">
          {formatRelativeTime(p.createdAt)}
        </span>
      ),
      getBest: () => new Set<string>(),
    },
    {
      label: "Health",
      icon: <Activity className="h-3.5 w-3.5 text-muted-foreground" />,
      render: (p) => {
        const health = getHealthStatus(p);
        return (
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${health.color}`} />
            <span className="text-muted-foreground">{health.label}</span>
          </div>
        );
      },
      getBest: () => new Set<string>(),
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-200 ease-out ${
          isVisible ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ height: "60vh", minHeight: 400 }}
      >
        <div className="h-full bg-background border-t border-border rounded-t-xl shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 rounded-full bg-muted-foreground/30 absolute left-1/2 -translate-x-1/2 top-1.5" />
              <h2 className="text-sm font-semibold tracking-tight">
                Comparing {plugins.length} plugin{plugins.length !== 1 ? "s" : ""}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-7 w-7 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm min-w-[500px]">
              {/* Plugin headers */}
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b border-border">
                  <th className="text-left p-3 w-28 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Metric
                  </th>
                  {plugins.map((plugin) => (
                    <th key={plugin.id} className="p-3 text-left">
                      <div className="flex items-center gap-2.5 mb-2">
                        <img
                          src={plugin.ownerAvatar}
                          alt={plugin.owner}
                          className="w-8 h-8 rounded-full ring-1 ring-border"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate capitalize">
                            {plugin.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {plugin.owner}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemove(plugin.id)}
                          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
                        >
                          <X className="h-3 w-3 mr-0.5" />
                          Remove
                        </Button>
                        <a
                          href={plugin.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          GitHub
                        </a>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Data rows */}
              <tbody>
                {rows.map((row, i) => {
                  const bestIds = row.getBest(plugins);
                  return (
                    <tr
                      key={row.label}
                      className={`border-b border-border/50 ${
                        i % 2 === 0 ? "bg-secondary/20" : ""
                      }`}
                    >
                      <td className="p-3 w-28">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          {row.icon}
                          {row.label}
                        </div>
                      </td>
                      {plugins.map((plugin) => (
                        <td key={plugin.id} className="p-3 text-sm">
                          {row.render(plugin, bestIds.has(plugin.id))}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

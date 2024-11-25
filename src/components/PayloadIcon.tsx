import { cn } from "@/lib/utils";

export const PayloadIcon = ({className} :{ className?:string}) => {
  return (
    <svg
      width="260"
      height="260"
      viewBox="0 0 260 260"
      fill="none"
      className={cn("fill-black dark:fill-white",className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M120.59 8.5824L231.788 75.6142V202.829L148.039 251.418V124.203L36.7866 57.2249L120.59 8.5824Z" />
      <path d="M112.123 244.353V145.073L28.2114 193.769L112.123 244.353Z" />
    </svg>
  );
};

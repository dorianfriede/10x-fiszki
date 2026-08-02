import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineErrorProps {
  message: string;
  size?: "sm" | "xs";
}

export function InlineError({ message, size = "sm" }: InlineErrorProps) {
  return (
    <p className={cn("flex items-center gap-1 text-red-300", size === "xs" ? "text-xs" : "text-sm")}>
      <CircleAlert className={size === "xs" ? "size-3" : "size-4 shrink-0"} />
      {message}
    </p>
  );
}

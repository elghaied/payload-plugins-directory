export function TrendEmpty({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      <p>{message}</p>
    </div>
  )
}

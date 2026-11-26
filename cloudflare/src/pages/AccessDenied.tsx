import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  feature: string;
  required: string;
};

export function AccessDenied({ feature, required }: Props) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center" data-testid="access-denied">
      <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">You don't have access to {feature}</h1>
      <p className="text-sm text-muted-foreground">
        Ask an admin. Required role or permission: <span className="font-medium">{required}</span>.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Back to executive summary</Link>
      </Button>
    </div>
  );
}

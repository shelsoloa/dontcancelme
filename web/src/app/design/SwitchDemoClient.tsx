"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/Switch";

export function SwitchDemoClient() {
  const [on, setOn] = useState(true);
  return (
    <Switch
      checked={on}
      onChange={setOn}
      label="Auto-scrub critical posts on detection"
    />
  );
}

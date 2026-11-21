import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchConflicts } from "../data/admin";
import { useOnline } from "../lib/useOnline";
import { buttonClass } from "./ui";
import { es } from "../i18n/es";

/** On the specialist's queue: a way into their own clinical conflicts, only when there are some (online). */
export function ClinicalConflictsLink() {
  const online = useOnline();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!online) return;
    fetchConflicts()
      .then((list) => setCount(list.length))
      .catch(() => setCount(0));
  }, [online]);
  if (!online || count === 0) return null;
  return (
    <Link to="/admin/conflicts" className={buttonClass("outline", "w-full")}>
      {es.admin.conflicts.fromQueue(count)}
    </Link>
  );
}

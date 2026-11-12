import {redirect} from "next/navigation";

// Keep previously distributed links working without another account page.
export default function RemoteAccess(){redirect("/login");}

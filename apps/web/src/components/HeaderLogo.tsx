import { Link } from "react-router";
import logo from "../assets/logo.png";

// The logo in a page header. It takes you back to the home page.
export function HeaderLogo() {
  return (
    <Link to="/" className="rounded-lg">
      <img src={logo} alt="Dfit Studio" className="h-10 w-auto" />
    </Link>
  );
}

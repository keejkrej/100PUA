import { runHttpApiRequest } from "@100pua/api";

export async function GET(request: Request) {
  return runHttpApiRequest(request);
}

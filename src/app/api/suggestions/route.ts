import { runHttpApiRequest } from "@100pua/api";

export async function POST(request: Request) {
  return runHttpApiRequest(request);
}

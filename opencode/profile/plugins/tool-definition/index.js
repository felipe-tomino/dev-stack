import { z } from "zod";

export function tool(definition) {
	return definition;
}

tool.schema = z;

import { Option, Schema } from "effect";

/**
 * A decoder for one Dispatch event's `data`: the decoded value, or undefined
 * when it does not match (the event is then ignored, as the web client does
 * with frames it cannot read).
 */
export function eventDecoder<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
): (data: unknown) => S["Type"] | undefined {
  const decode = Schema.decodeUnknownOption(schema);
  return (data) => Option.getOrUndefined(decode(data));
}

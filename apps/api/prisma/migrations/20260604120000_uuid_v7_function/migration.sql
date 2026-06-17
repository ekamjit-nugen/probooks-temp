-- uuid_generate_v7(): time-ordered UUIDv7 (STANDARDS §5.2 — UUID v7 PKs).
-- Postgres 16 has no built-in generator (the SQL-standard one arrives later),
-- so we define a standard PL/pgSQL implementation per RFC 9562:
--   - 48 bits  Unix epoch milliseconds (big-endian) in the first 6 bytes
--   - 4 bits   version (0b0111 = 7) in the high nibble of byte 7
--   - 2 bits   variant (0b10) in the high bits of byte 9
--   - remaining bits filled from gen_random_bytes (cryptographic randomness)
-- Time-ordering gives good B-tree locality for our tenant_id+created_at indexes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  unix_ts_ms  bigint;
  uuid_bytes  bytea;
BEGIN
  unix_ts_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  -- 16 random bytes; we overwrite the timestamp + version + variant fields.
  uuid_bytes := gen_random_bytes(16);

  -- Bytes 0-5: 48-bit big-endian millisecond timestamp. set_byte takes an
  -- integer value, so each masked byte is cast back from bigint to integer.
  uuid_bytes := set_byte(uuid_bytes, 0, ((unix_ts_ms >> 40) & 255)::integer);
  uuid_bytes := set_byte(uuid_bytes, 1, ((unix_ts_ms >> 32) & 255)::integer);
  uuid_bytes := set_byte(uuid_bytes, 2, ((unix_ts_ms >> 24) & 255)::integer);
  uuid_bytes := set_byte(uuid_bytes, 3, ((unix_ts_ms >> 16) & 255)::integer);
  uuid_bytes := set_byte(uuid_bytes, 4, ((unix_ts_ms >> 8) & 255)::integer);
  uuid_bytes := set_byte(uuid_bytes, 5, (unix_ts_ms & 255)::integer);

  -- Byte 6 high nibble = version 7 (keep low nibble random).
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);

  -- Byte 8 high bits = variant 0b10 (keep low 6 bits random).
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);

  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;

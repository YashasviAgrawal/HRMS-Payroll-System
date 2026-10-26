-- The audit trail cannot be edited or deleted (PRD §16 "Audit trail ... cannot be edited; kept 8 years").
CREATE OR REPLACE FUNCTION audit_log_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are append-only (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_change();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_change();

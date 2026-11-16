-- Charge new Oracle questions 10 coins from the existing vending balance.
-- Charges are transactional with the question insert, and terminal failures refund once.
-- Historical questions remain free and untouched.
CREATE TABLE IF NOT EXISTS oracle_charges (
  query_id INTEGER PRIMARY KEY REFERENCES oracle_queries(id),
  amount INTEGER NOT NULL CHECK(amount = 10),
  charged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  refunded_at TEXT
);

CREATE TRIGGER IF NOT EXISTS nimo_oracle_charge_on_insert
AFTER INSERT ON oracle_queries
BEGIN
  SELECT RAISE(ABORT,'Oracle costs 10 coins')
  WHERE NOT EXISTS (SELECT 1 FROM vending_state WHERE id=1 AND coins>=10);
  UPDATE vending_state SET coins=coins-10 WHERE id=1 AND coins>=10;
  INSERT INTO oracle_charges(query_id,amount) VALUES (NEW.id,10);
END;

CREATE TRIGGER IF NOT EXISTS nimo_oracle_refund_on_failure
AFTER UPDATE OF status ON oracle_queries
WHEN NEW.status='failed' AND OLD.status!='failed'
BEGIN
  UPDATE oracle_charges
  SET refunded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE query_id=NEW.id AND refunded_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS nimo_oracle_return_refund
AFTER UPDATE OF refunded_at ON oracle_charges
WHEN OLD.refunded_at IS NULL AND NEW.refunded_at IS NOT NULL
BEGIN
  UPDATE vending_state SET coins=coins+NEW.amount WHERE id=1;
END;

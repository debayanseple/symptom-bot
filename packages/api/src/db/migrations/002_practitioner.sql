-- ---------------------------------------------------------------------------
-- 002_practitioner — named doctors + name search
--
-- OpenStreetMap has no practitioner roster: there is no tag listing the
-- doctors who work at a hospital, and `healthcare:practitioner` does not
-- appear anywhere in the Kolkata extract. What it does have is facilities
-- *named* after the doctor who runs them ("Dr. D.S.Chopra", "Dr Paul's
-- Clinic"). This column holds that extracted name so those entries can be
-- presented as a named doctor rather than as an anonymous clinic.
-- ---------------------------------------------------------------------------

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS practitioner TEXT;

-- Fuzzy name lookup for "find Dr Chopra" / "Ruby General" style searches.
CREATE INDEX IF NOT EXISTS facilities_practitioner_trgm_idx
  ON facilities USING GIN (practitioner gin_trgm_ops);

-- Partial index for the common filter "only entries with a named doctor".
CREATE INDEX IF NOT EXISTS facilities_has_practitioner_idx
  ON facilities (practitioner) WHERE practitioner IS NOT NULL;

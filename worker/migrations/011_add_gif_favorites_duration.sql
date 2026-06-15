-- Migration: Add duration column to gif_favorites
ALTER TABLE gif_favorites ADD COLUMN duration REAL;

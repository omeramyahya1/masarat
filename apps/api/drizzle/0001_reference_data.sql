-- Reference data: the cities trips run between, the per-km cargo rates, and the default tax
-- percentages (basis points) and fees (SDG)
INSERT INTO "cities" ("name", "name_ar", "state", "lat", "lng") VALUES
  ('Khartoum', 'الخرطوم', 'Khartoum', 15.6031, 32.5265),
  ('Omdurman', 'أم درمان', 'Khartoum', 15.6835, 32.4629),
  ('Khartoum North', 'الخرطوم بحري', 'Khartoum', 15.6333, 32.6333),
  ('Port Sudan', 'بورتسودان', 'Red Sea', 19.6158, 37.2164),
  ('El Obeid', 'الأبيض', 'North Kordofan', 13.1833, 30.2167),
  ('Kassala', 'كسلا', 'Kassala', 15.45, 36.4),
  ('Kūstī', 'كوستي', 'White Nile', 13.1667, 32.6667),
  ('Nyala', 'نيالا', 'South Darfur', 12.05, 24.8833),
  ('Wad Medani', 'ود مدني', 'Gezira', 14.4, 33.51),
  ('Gedaref', 'القضارف', 'Gedaref', 14.0333, 35.3833),
  ('El Fasher', 'الفاشر', 'North Darfur', 13.627, 25.3496),
  ('Ed Daein', 'الضعين', 'East Darfur', 11.4333, 26.15),
  ('Singa', 'سنجة', 'Sennar', 13.1483, 33.9311),
  ('Kurmuk', 'الكرمك', 'Blue Nile', 10.5563, 34.2848),
  ('Ar Ruseris', 'الروصيرص', 'Blue Nile', 11.8633, 34.3877),
  ('Ed Damazin', 'الدمازين', 'Blue Nile', 11.7667, 34.35),
  ('El Geneina', 'الجنينة', 'West Darfur', 13.45, 22.45),
  ('Kabkābīyah', 'كبكابية', 'North Darfur', 13.9154, 23.7936),
  ('Sannār', 'سنار', 'Sennar', 13.55, 33.6),
  ('Atbara', 'عطبرة', 'River Nile', 17.7167, 33.9833),
  ('Ed Damer', 'الدامر', 'River Nile', 17.5928, 33.9592),
  ('Umm Badr', 'أم بدر', 'North Kordofan', 14.2167, 27.9333),
  ('An Nuhūd', 'النهود', 'West Kordofan', 12.7, 28.4333),
  ('Al Manāqil', 'المناقل', 'Gezira', 14.2458, 32.9892),
  ('Kadugli', 'كادوقلي', 'South Kordofan', 11.0111, 29.7183),
  ('Ad Diwem', 'الدويم', 'White Nile', 14, 32.3167),
  ('Umm Ruwaba', 'أم روابة', 'North Kordofan', 12.9058, 31.2156),
  ('Dongola', 'دنقلا', 'Northern', 19.1769, 30.4839),
  ('Shendi', 'شندي', 'River Nile', 16.6914, 33.4339),
  ('Ad Dabbah', 'الدبة', 'Northern', 18.0502, 30.9495),
  ('Mellit', 'مليط', 'North Darfur', 14.1333, 25.55),
  ('Abū Ḩamad', 'أبو حمد', 'River Nile', 19.5375, 33.3275),
  ('Sawākin', 'سواكن', 'Red Sea', 19.1025, 37.33),
  ('Tokār', 'طوكر', 'Red Sea', 18.4258, 37.7278),
  ('Kutum', 'كتم', 'North Darfur', 14.2056, 24.65),
  ('Babanūsah', 'بابنوسة', 'West Kordofan', 11.3291, 27.8102),
  ('Zalingei', 'زالنجي', 'Central Darfur', 12.9, 23.4833),
  ('Rabak', 'ربك', 'White Nile', 13.15, 32.7333),
  ('El Fula', 'الفولة', 'West Kordofan', 11.8, 28.4);
--> statement-breakpoint
INSERT INTO "tax_rates" ("cargo_type", "rate_per_km", "unit", "per_quantity") VALUES
  ('fuel', 2000, 'liter', 1000),
  ('containers', 2000, 'ton', 1),
  ('general_cargo', 2000, 'ton', 1),
  ('liquids', 2000, 'liter', 1000);
--> statement-breakpoint
INSERT INTO "tax_settings" ("code", "rate_bps", "amount") VALUES
  ('vat', 1700, NULL),
  ('business_profit', 300, NULL),
  ('locality', 200, NULL),
  ('manifest_fee', NULL, 1500);

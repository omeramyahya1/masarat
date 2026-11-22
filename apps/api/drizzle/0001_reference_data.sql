-- Reference data: Sudan's 18 states and the cities trips run between, the per-km cargo rates,
-- and the default tax percentages (basis points) and fees (SDG). States are inserted first, then
-- their cities, then each state's capital.
INSERT INTO "states" ("name", "name_ar") VALUES
  ('Khartoum', 'الخرطوم'),
  ('Northern', 'الشمالية'),
  ('River Nile', 'نهر النيل'),
  ('Red Sea', 'البحر الأحمر'),
  ('Kassala', 'كسلا'),
  ('Gedaref', 'القضارف'),
  ('Gezira', 'الجزيرة'),
  ('Sennar', 'سنار'),
  ('Blue Nile', 'النيل الأزرق'),
  ('White Nile', 'النيل الأبيض'),
  ('North Kordofan', 'شمال كردفان'),
  ('West Kordofan', 'غرب كردفان'),
  ('South Kordofan', 'جنوب كردفان'),
  ('North Darfur', 'شمال دارفور'),
  ('West Darfur', 'غرب دارفور'),
  ('Central Darfur', 'وسط دارفور'),
  ('South Darfur', 'جنوب دارفور'),
  ('East Darfur', 'شرق دارفور');
--> statement-breakpoint
INSERT INTO "cities" ("name", "name_ar", "state_id", "lat", "lng")
SELECT c."name", c."name_ar", s."id", c."lat", c."lng" FROM (VALUES
  ('Bahri', 'بحري', 'Khartoum', 15.6333, 32.6333),
  ('Khartoum', 'الخرطوم', 'Khartoum', 15.500654, 32.559898),
  ('Omdurman', 'أم درمان', 'Khartoum', 15.65, 32.483334),
  ('Ad Dabbah', 'الدبة', 'Northern', 18.0502, 30.9495),
  ('Dongola', 'دنقلا', 'Northern', 19.169825, 30.474894),
  ('Karima', 'كريمة', 'Northern', 18.55, 31.85),
  ('Merowe', 'مروي', 'Northern', 18.483333, 31.833333),
  ('Wadi Halfa', 'وادي حلفا', 'Northern', 21.8, 31.35),
  ('Wawa', 'واوة', 'Northern', 20.45, 30.35),
  ('Abu Hamad', 'أبو حمد', 'River Nile', 19.5375, 33.3275),
  ('Atbara', 'عطبرة', 'River Nile', 17.7, 33.99),
  ('Ed Damer', 'الدامر', 'River Nile', 17.5928, 33.9592),
  ('Shendi', 'شندي', 'River Nile', 16.69, 33.43),
  ('Aroma', 'أروما', 'Red Sea', 17, 36.283333),
  ('Jebeit', 'جبيت', 'Red Sea', 17.85, 36.9),
  ('Port Sudan', 'بورتسودان', 'Red Sea', 19.616667, 37.216667),
  ('Sinkat', 'سنكات', 'Red Sea', 18.866667, 36.883333),
  ('Suakin', 'سواكن', 'Red Sea', 19.1, 37.333333),
  ('Tokar', 'طوكر', 'Red Sea', 18.433333, 37.716667),
  ('Hamashkoreib', 'همشكوريب', 'Kassala', 16.1, 36.55),
  ('Kassala', 'كسلا', 'Kassala', 15.4552, 36.4013),
  ('New Halfa', 'حلفا الجديدة', 'Kassala', 15.33, 35.6),
  ('Doka', 'الدوكة', 'Gedaref', 13.516667, 35.766667),
  ('Gallabat', 'القلابات', 'Gedaref', 12.966667, 36.4),
  ('Gedaref', 'القضارف', 'Gedaref', 14.03998, 35.38),
  ('Al Hasaheisa', 'الحصاحيصا', 'Gezira', 14.733333, 33.3),
  ('Al Managil', 'المناقل', 'Gezira', 14.245, 32.989),
  ('Rufaa', 'رفاعة', 'Gezira', 14.15, 33.25),
  ('Wad Madani', 'ود مدني', 'Gezira', 14.4, 33.5167),
  ('Abu Hujar', 'أبو حجار', 'Sennar', 13.347, 33.893),
  ('Dinder', 'الدندر', 'Sennar', 12.516667, 34.15),
  ('Sennar', 'سنار', 'Sennar', 13.57, 33.57),
  ('Singa', 'سنجة', 'Sennar', 13.15, 33.933),
  ('Ed Damazin', 'الدمازين', 'Blue Nile', 11.77, 34.35),
  ('Geissan', 'قيسان', 'Blue Nile', 11.33, 34.14),
  ('Kurmuk', 'الكرمك', 'Blue Nile', 10.5563, 34.2848),
  ('Roseires', 'الروصيرص', 'Blue Nile', 11.6, 34.4),
  ('Al Gitaina', 'القطينة', 'White Nile', 14.8648, 32.3668),
  ('Al Kawa', 'الكوة', 'White Nile', 13.7463, 32.4996),
  ('Ed Dueim', 'الدويم', 'White Nile', 14.0012, 32.3116),
  ('Kosti', 'كوستي', 'White Nile', 13.1629, 32.66347),
  ('Rabak', 'ربك', 'White Nile', 13.18087, 32.73999),
  ('Tendelti', 'تندلتي', 'White Nile', 13.016667, 32.683333),
  ('Bara', 'بارا', 'North Kordofan', 13.7, 30.366667),
  ('El Obeid', 'الأبيض', 'North Kordofan', 13.1833, 30.2177),
  ('Er Rahad', 'الرهد', 'North Kordofan', 12.716667, 30.65),
  ('Umm Badr', 'أم بدر', 'North Kordofan', 14.2167, 27.9333),
  ('Umm Ruwaba', 'أم روابة', 'North Kordofan', 12.910438, 31.199997),
  ('Al Muglad', 'المجلد', 'West Kordofan', 11.033333, 27.733333),
  ('Babanusa', 'بابنوسة', 'West Kordofan', 11.333333, 27.8),
  ('El Fula', 'الفولة', 'West Kordofan', 11.95, 28.4),
  ('En Nahud', 'النهود', 'West Kordofan', 12.7, 28.43),
  ('Abu Jubaiha', 'أبو جبيهة', 'South Kordofan', 11.456, 31.222),
  ('Dilling', 'الدلنج', 'South Kordofan', 12.05, 29.65),
  ('Kadugli', 'كادوقلي', 'South Kordofan', 11.007893, 29.715408),
  ('Talodi', 'تالودي', 'South Kordofan', 10.632, 30.379),
  ('El Fasher', 'الفاشر', 'North Darfur', 13.63, 25.35),
  ('Kabkabiya', 'كبكابية', 'North Darfur', 13.453, 24.29),
  ('Kutum', 'كتم', 'North Darfur', 14.2, 24.666667),
  ('Mellit', 'مليط', 'North Darfur', 14.1333, 25.55),
  ('El Geneina', 'الجنينة', 'West Darfur', 13.45, 22.45),
  ('Bindisi', 'بندسي', 'Central Darfur', 12.5, 22.85),
  ('Zalingei', 'زالنجي', 'Central Darfur', 12.909, 23.474),
  ('Nyala', 'نيالا', 'South Darfur', 12.05, 24.9),
  ('Ed Daein', 'الضعين', 'East Darfur', 11.46, 26.13)
) AS c("name", "name_ar", "state", "lat", "lng")
JOIN "states" s ON s."name" = c."state";
--> statement-breakpoint
UPDATE "states" s SET "capital_city_id" = c."id"
FROM (VALUES
  ('Khartoum', 'Khartoum'),
  ('Northern', 'Dongola'),
  ('River Nile', 'Ed Damer'),
  ('Red Sea', 'Port Sudan'),
  ('Kassala', 'Kassala'),
  ('Gedaref', 'Gedaref'),
  ('Gezira', 'Wad Madani'),
  ('Sennar', 'Singa'),
  ('Blue Nile', 'Ed Damazin'),
  ('White Nile', 'Rabak'),
  ('North Kordofan', 'El Obeid'),
  ('West Kordofan', 'El Fula'),
  ('South Kordofan', 'Kadugli'),
  ('North Darfur', 'El Fasher'),
  ('West Darfur', 'El Geneina'),
  ('Central Darfur', 'Zalingei'),
  ('South Darfur', 'Nyala'),
  ('East Darfur', 'Ed Daein')
) AS capital("state", "city")
JOIN "cities" c ON c."name" = capital."city"
WHERE s."name" = capital."state";
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
--> statement-breakpoint
-- The government's two fixed roles. Their permissions come from the code (LOCKED_ROLE_KEYS in
-- packages/shared/src/permissions.ts), so nothing goes into role_permissions for them.
INSERT INTO "roles" ("company_id", "key", "name", "scope") VALUES
  (NULL, 'govt_admin', 'Government admin', 'company'),
  (NULL, 'govt_agent', 'Government agent', 'company');

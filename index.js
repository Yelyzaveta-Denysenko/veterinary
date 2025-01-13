const express = require("express");
const ejs = require("ejs");
const { Client } = require("pg");
const bodyParser = require("body-parser");
const ExcelJS = require('exceljs');

const client = new Client({
    user: "yelyzaveta",
    host: "localhost",
    database: "postgres",
    password: "525422",
    port: 5432,
});

client.connect()
    .then(() => console.log("Підключено до PostgreSQL"))
    .catch(err => console.error("Помилка підключення", err.stack));

function runDBCommand(queryConfig) {
    return client.query(queryConfig);
}

let app = express();
app.set("view engine", "ejs");

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static("public"));

app.get("/", async (req, res) => {
    console.log("GET /");

    const { animal_id } = req.query;

    // LEFT JOIN with owners to display short info about the owner
    let query = `
        SELECT 
            a.animals_id, 
            a.name, 
            a.breed, 
            a.birthday, 
            a.gender, 
            a.vaccination,
            a.owners_id,
            o.last_name AS owner_last_name,
            o.first_name AS owner_first_name
        FROM veterinary.animals a
        LEFT JOIN veterinary.owners o 
            ON a.owners_id = o.owners_id
    `;
    const params = [];

    // Optional: filter by animal_id if user searches by ID
    if (animal_id) {
        query += ` WHERE a.animals_id = $1`;
        params.push(animal_id); 
    }

    try {
        const data = await runDBCommand({ text: query, values: params });
        res.render("animals", { animals: data.rows });
    } catch (error) {
        console.error("Error fetching animals:", error);
        res.status(500).send("Error fetching animals.");
    }
});


app.get("/add-animal", async (req, res) => {
    console.log("GET /add-animal");

    try {
        // Fetch the list of owners
        const ownersResult = await runDBCommand({
            text: "SELECT owners_id, last_name, first_name FROM veterinary.owners ORDER BY last_name",
        });
        res.render("add-animal", { owners: ownersResult.rows });
    } catch (error) {
        console.error("Error loading add-animal form:", error);
        res.status(500).send("Error loading form for new animal.");
    }
});


app.post("/add-animal", async (req, res) => {
    console.log("POST /add-animal");
    const { name, breed, birthday, gender, vaccination, owners_id } = req.body;
    const isVaccinated = (vaccination === "Так");

    // Convert empty string to null if not chosen
    const ownerIdValue = owners_id ? owners_id : null;

    const query = `
        INSERT INTO veterinary.animals 
            (name, breed, birthday, gender, vaccination, owners_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`;

    try {
        const result = await runDBCommand({
            text: query,
            values: [name, breed, birthday, gender, isVaccinated, ownerIdValue],
        });
        console.log("New animal added:", result.rows[0]);
        res.redirect("/");
    } catch (error) {
        console.error("Error adding animal:", error);
        res.status(500).send("Error adding the animal.");
    }
});


app.get("/animal-history/:animals_id", async (req, res) => {
    const animalId = req.params.animals_id;

    const query = `
        SELECT 
            se.services_name,
            se.description,
            se.price,
            se.service_category,
            an.name,
            an.breed,
            an.birthday,
            an.gender,
            an.vaccination,
            ap.appointment_date,
            ap.appointment_time,
            ap.status,
            se.duration
        FROM veterinary.appointment ap
        LEFT JOIN veterinary.animals an ON ap.animal_id = an.animals_id
        LEFT JOIN veterinary.services se ON ap.services_id = se.services_id
        WHERE an.animals_id = $1
    `;

    try {
        const result = await runDBCommand({ text: query, values: [animalId] });
        res.render("animal-history", { history: result.rows });
    } catch (error) {
        console.error("Error fetching animal history:", error);
        res.status(500).send("Error fetching animal history.");
    }
});

app.get("/update/:animals_id", async (req, res) => {
    const animalId = req.params.animals_id;

    try {
        // Fetch the animal we want to update
        const animalQuery = `
            SELECT * 
            FROM veterinary.animals 
            WHERE animals_id = $1
        `;
        const animalResult = await runDBCommand({
            text: animalQuery,
            values: [animalId],
        });
        
        if (animalResult.rows.length === 0) {
            return res.status(404).send("Тварину не знайдено.");
        }
        const animal = animalResult.rows[0];

        // Fetch all owners to populate a dropdown
        const ownersQuery = `
            SELECT owners_id, last_name, first_name 
            FROM veterinary.owners 
            ORDER BY last_name
        `;
        const ownersResult = await runDBCommand({
            text: ownersQuery
        });

        // Render the EJS, passing both the animal and the list of owners
        res.render("update-animal", {
            animal,
            owners: ownersResult.rows
        });
    } catch (error) {
        console.error("Error fetching animal data for update:", error);
        res.status(500).send("Error fetching animal data.");
    }
});

app.post("/update/:animals_id", async (req, res) => {
    const animalId = req.params.animals_id;
    const { name, breed, birthday, gender, vaccination, owners_id } = req.body;
    const isVaccinated = (vaccination === "Так");

    // Convert empty string (if user chooses no owner) to null
    const ownerIdValue = owners_id ? owners_id : null;

    const query = `
        UPDATE veterinary.animals
        SET 
            name = $1,
            breed = $2,
            birthday = $3,
            gender = $4,
            vaccination = $5,
            owners_id = $6
        WHERE animals_id = $7
    `;

    try {
        await runDBCommand({
            text: query,
            values: [name, breed, birthday, gender, isVaccinated, ownerIdValue, animalId]
        });
        console.log("Animal updated successfully");
        res.redirect("/");
    } catch (error) {
        console.error("Error updating animal:", error);
        res.status(500).send("Error updating the animal.");
    }
});

app.get('/search', (req, res) => {
    const id = req.query.id;
    url = `/`
    if (id) {url += `?animal_id=${encodeURIComponent(id)}`}
    res.redirect(url);
});

app.post("/delete/:animals_id", async (req, res) => {
    const animalId = req.params.animals_id;

    const query = `DELETE FROM veterinary.animals WHERE animals_id = $1`;

    try {
        await runDBCommand({ text: query, values: [animalId] });
        console.log(`Animal with ID ${animalId} deleted successfully`);
        res.redirect("/");
    } catch (error) {
        console.error("Error deleting animal:", error);
        res.status(500).send("Error deleting the animal.");
    }
});

app.get("/add-appointment", async (req, res) => {
    try {
        const animalsResult = await runDBCommand({ text: "SELECT * FROM veterinary.animals" });

        const servicesResult = await runDBCommand({ text: "SELECT * FROM veterinary.services" });

        res.render("add-appointment", {
            animals: animalsResult.rows,
            services: servicesResult.rows
        });
    } catch (error) {
        console.error("Помилка отримання даних для форми:", error);
        res.status(500).send("Помилка отримання даних для форми.");
    }
});

app.post("/add-appointment", async (req, res) => {
    const { animal_id, service_id, appointment_date, appointment_time } = req.body;

    try {
        const query = `
            INSERT INTO veterinary.appointment (appointment_date, appointment_time, animal_id, services_id, status)
            VALUES ($1, $2, $3, $4, 'Scheduled') RETURNING *`;

        const result = await runDBCommand({
            text: query,
            values: [appointment_date, appointment_time, animal_id, service_id],
        });

        console.log("Новий запис на прийом створено:", result.rows[0]);
        res.redirect("/");
    } catch (error) {
        console.error("Помилка при створенні запису на прийом:", error);
        res.status(500).send("Помилка при створенні запису на прийом.");
    }
});

app.get("/appointments", async (req, res) => {
    const filterStatus = req.query.status;

    try {
        const query = `
            SELECT 
                ap.appointment_id as id,
                an.name as animal_name,
                se.services_name as service_name,
                ap.appointment_date as date,
                ap.appointment_time as time,
                ap.status            
            FROM veterinary.appointment ap
            LEFT JOIN veterinary.animals an
                on ap.animal_id = an.animals_id
            LEFT JOIN veterinary.services se
                on ap.services_id = se.services_id
        `;
        
        const data = await runDBCommand({ text: query });

        res.render("appointments", {
            appointments: data.rows,
            filterStatus: filterStatus
        });

    } catch (error) {
        console.error("Помилка отримання даних для форми:", error);
        res.status(500).send("Помилка отримання даних для форми.");
    }
});

app.post('/appointments/start/:id', async (req, res) => {
    const appointmentId = req.params.id;

    const query = `
            UPDATE veterinary.appointment
            SET status = 'In progress', status_start_time = NOW()
            WHERE appointment_id = $1
            RETURNING *;
        `;

    try {
        const result = await runDBCommand({ text: query, values: [appointmentId] });
        const appointment = result.rows[0];

        console.log("Appointment updated successfully");
        res.json({ url: `/appointments/in-progress/${appointmentId}` });
    } catch (error) {
        console.error("Error updating animal:", error);
        res.status(500).send("Error updating the animal.");
    }
});

app.get('/appointments/in-progress/:id', async (req, res) => {
    const appointmentId = req.params.id;

    const query = `
        SELECT 
            ap.appointment_id as id,
            an.name as animal_name,
            se.services_name as service_name,
            ap.appointment_date as date,
            ap.appointment_time as time,
            ap.status,
            ap.status_start_time
        FROM veterinary.appointment ap
        LEFT JOIN veterinary.animals an
            ON ap.animal_id = an.animals_id
        LEFT JOIN veterinary.services se
            ON ap.services_id = se.services_id
        WHERE ap.appointment_id = $1
    `;

    try {
        const result = await runDBCommand({ text: query, values: [appointmentId] });

        if (result.rows.length === 0) {
            return res.status(404).send("Прийом не знайдено");
        }

        res.render('appointment-in-progress', {
            appointment: result.rows[0],
        });
    } catch (error) {
        console.error("Помилка завантаження деталей прийому:", error);
        res.status(500).send("Помилка завантаження деталей прийому.");
    }
});

app.get('/appointments/finish/:id', async (req, res) => {
    const appointmentId = req.params.id;

    const query = `
        SELECT 
            ap.appointment_id AS id,
            an.name AS animal_name,
            se.services_name AS service_name,
            ap.appointment_date AS date,
            ap.appointment_time AS time
        FROM veterinary.appointment ap
        LEFT JOIN veterinary.animals an ON ap.animal_id = an.animals_id
        LEFT JOIN veterinary.services se ON ap.services_id = se.services_id
        WHERE ap.appointment_id = $1
    `;

    try {
        const { rows } = await runDBCommand({ text: query, values: [appointmentId] });
        if (rows.length > 0) {
            res.render('medical-record', { appointment: rows[0] });
        } else {
            res.status(404).send("Appointment not found.");
        }
    } catch (error) {
        console.error("Error fetching appointment:", error);
        res.status(500).send("Error fetching appointment.");
    }
});

app.post('/medical-records/create', async (req, res) => {
    const { appointment_id, diagnosis, treatment, preparations } = req.body;

    const createRecordQuery = `
        INSERT INTO veterinary.medical_record (appointment_id, diagnosis, treatment, preparations, record_date)
        VALUES ($1, $2, $3, $4, NOW())
    `;

    const updateAppointmentQuery = `
        UPDATE veterinary.appointment
        SET status = 'Not paid', status_end_time = NOW()
        WHERE appointment_id = $1
    `;

    try {
        await runDBCommand({ text: createRecordQuery, values: [appointment_id, diagnosis, treatment, preparations] });
        await runDBCommand({ text: updateAppointmentQuery, values: [appointment_id] });

        res.redirect('/appointments');
    } catch (error) {
        console.error("Error creating medical record:", error);
        res.status(500).send("Error creating medical record.");
    }
});

app.get('/appointments/payment/:id', async (req, res) => {
    const appointmentId = req.params.id;

    try {
        const query = `
            SELECT 
                a.appointment_id, 
                a.appointment_date, 
                a.appointment_time, 
                a.status_start_time, 
                a.status_end_time, 
                s.services_name, 
                s.price AS service_cost,
                EXTRACT(EPOCH FROM (a.status_end_time - a.status_start_time)) / 60 AS duration_minutes,

                -- Medical record details
                mr.diagnosis, 
                mr.treatment, 
                mr.preparations

            FROM veterinary.Appointment a
            JOIN veterinary.Services s ON a.services_id = s.services_id
            LEFT JOIN veterinary.medical_record mr ON a.appointment_id = mr.appointment_id

            WHERE a.appointment_id = $1
        `;
        const result = await runDBCommand({ text: query, values: [appointmentId] });
        const appointment = result.rows[0];

        const totalCost = appointment.service_cost;

        res.render('add-payment', {
            appointment: {
                id: appointment.appointment_id,
                service_name: appointment.services_name,
                duration: Math.ceil(appointment.duration_minutes),
                cost: totalCost,
                medical_record: {
                    diagnosis: appointment.diagnosis || 'Немає даних',
                    treatment: appointment.treatment || 'Немає даних',
                    preparations: appointment.preparations || 'Немає даних'
                }
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/appointments/payment/submit/:id', async (req, res) => {
    const appointmentId = req.params.id;
    const { payment_method } = req.body;

    try {
        const insertQuery = `
            INSERT INTO veterinary.financial_operation 
            (appointment_id, amount, operation_method, operation_date, operation_status)
            VALUES ($1, 
                    (SELECT s.price FROM veterinary.Appointment a 
                     JOIN veterinary.Services s ON a.services_id = s.services_id 
                     WHERE a.appointment_id = $1), 
                    $2, CURRENT_TIMESTAMP, 'Paid')
        `;
        await runDBCommand({ text: insertQuery, values: [appointmentId, payment_method] });

        const updateQuery = `
            UPDATE veterinary.Appointment 
            SET status = 'Completed'
            WHERE appointment_id = $1
        `;
        await runDBCommand({ text: updateQuery, values: [appointmentId] });

        res.send(`<script>window.close();</script>`);

    } catch (error) {
        console.error(error);
        res.status(500).send('Failed to process payment.');
    }
});

app.post('/appointments/cancel/:id', async (req, res) => {
    const appointmentId = req.params.id;

    try {
        const updateQuery = `
            UPDATE veterinary.Appointment
            SET status = 'Cancelled'
            WHERE appointment_id = $1
        `;
        await runDBCommand({ text: updateQuery, values: [appointmentId] });

        res.redirect('/appointments');
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        res.status(500).send('Помилка під час скасування прийому.');
    }
});

app.get('/appointments/details/:id', async (req, res) => {
    const appointmentId = req.params.id;
    
    try {
        const query = `
            SELECT 
                a.appointment_id, a.appointment_date, a.appointment_time, 
                a.status_start_time, a.status_end_time, 
                s.services_name, s.price AS service_cost,
                an.name as animal_name, an.birthday, an.breed,
                mr.diagnosis, mr.treatment, mr.preparations, mr.record_date,
                p.operation_method as payment_method, p.amount AS payment_amount
            FROM veterinary.appointment a
            JOIN veterinary.services s ON a.services_id = s.services_id
            JOIN veterinary.animals an ON a.animal_id = an.animals_id
            LEFT JOIN veterinary.medical_record mr ON a.appointment_id = mr.appointment_id
            LEFT JOIN veterinary.financial_operation p ON a.appointment_id = p.appointment_id
            WHERE a.appointment_id = $1
        `;

        const result = await runDBCommand({ text: query, values: [appointmentId] });
        const appointment = result.rows[0];

        if (!appointment) {
            return res.status(404).send('Appointment not found.');
        }

        res.render('appointment-details', { appointment });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// app.get("/supplies", async (req, res) => {
//     try {
//         res.render("supplies");
//     } catch (error) {
//         console.error("Error fetching supplies report:", error);
//         res.status(500).send("Error generating the report.");
//     }
// });

app.get("/supplies", async (req, res) => {
    try {
        const query = `
            WITH service_counts AS (
                SELECT 
                    date_trunc('month', appointment_date) as business_month,
                    s.services_id,
                    services_name,
                    count(ap.services_id) AS service_count
                FROM 
                    veterinary.appointment ap
                LEFT JOIN veterinary.services s ON ap.services_id = s.services_id
                GROUP BY 1, 2, 3
            ),

            ranked_services AS (
                SELECT 
                    business_month,
                    services_id,
                    services_name,
                    service_count,
                    ROW_NUMBER() OVER (PARTITION BY business_month ORDER BY service_count DESC) AS high_rank,
                    ROW_NUMBER() OVER (PARTITION BY business_month ORDER BY service_count asc) AS low_rank
                FROM service_counts
            ),

            monthly_statistic as (
                SELECT 
                    date_trunc('month', appointment_date) as business_month,
                    count(*) as appointment_amount,
                    count(*) filter(where status = 'Completed') as appointment_succeed,
                    count(*) filter(where status = 'Cancelled') as appointment_canceled,
                    floor(cast(count(*) filter(where status = 'Cancelled') as numeric) / cast(count(*) as numeric) * 100) as appointment_canceled_percent,
                    sum(fo.amount) as revenue
                FROM 
                    veterinary.appointment ap
                left join veterinary.financial_operation fo 
                    on ap.appointment_id = fo.appointment_id
                group by 1
            )

            SELECT 
                extract(year from ms.business_month) as year,
                extract(month from ms.business_month) as month,
                ms.appointment_amount,
                ms.appointment_succeed,
                ms.appointment_canceled,
                ms.appointment_canceled_percent,
                ms.revenue,
                rsh.services_name as top_service,
                rsl.services_name as bot_service
            FROM 
                monthly_statistic ms
            left join (select * from ranked_services where high_rank = 1 ) rsh
                on ms.business_month = rsh.business_month
            left join (select * from ranked_services where low_rank = 1 ) rsl
                on ms.business_month = rsl.business_month
        `;
        
        const result = await runDBCommand({ text: query });

        const workbook = new ExcelJS.Workbook();
        
        const worksheet1 = workbook.addWorksheet('Місяці');

        worksheet1.columns = [
            { header: 'Рік', key: 'year' },
            { header: 'Місяць', key: 'month' },
            { header: 'Кількість записів', key: 'appointment_amount' },
            { header: 'Завершені записи', key: 'appointment_succeed' },
            { header: 'Скасовані записи', key: 'appointment_canceled' },
            { header: 'Відсоток скасованих', key: 'appointment_canceled_percent' },
            { header: 'Дохід (UAH)', key: 'revenue' },
            { header: 'Найпопулярніша послуга', key: 'top_service' },
            { header: 'Найменш популярна послуга', key: 'bot_service' },
        ];

        result.rows.forEach(row => {
            worksheet1.addRow({
                year: row.year,
                month: row.month,
                appointment_amount: row.appointment_amount,
                appointment_succeed: row.appointment_succeed,
                appointment_canceled: row.appointment_canceled,
                appointment_canceled_percent: row.appointment_canceled_percent,
                revenue: row.revenue,
                top_service: row.top_service,
                bot_service: row.bot_service,
            });
        });

        const servicesQuery = `
            SELECT 
                services_name as service,
                count(*) as appointment_amount,
                count(*) filter(where status = 'Completed') as appointment_succeed,
                count(*) filter(where status = 'Cancelled') as appointment_canceled,
                floor(cast(count(*) filter(where status = 'Cancelled') as numeric) / cast(count(*) as numeric) * 100) as appointment_canceled_percent,
                coalesce(sum(fo.amount), 0) as revenue,
                count(distinct date_trunc('month', appointment_date)) as lifetime,
                floor(coalesce(sum(fo.amount), 0) / count(distinct date_trunc('month', appointment_date))) as avg_revenue_by_month
            FROM   
                veterinary.appointment ap
            left join veterinary.services s
                on ap.services_id = s.services_id
            left join veterinary.financial_operation fo 
                on ap.appointment_id = fo.appointment_id
            group by 1
        `;

        const servicesResult = await runDBCommand({ text: servicesQuery });

        const worksheet2 = workbook.addWorksheet('Послуги');

        worksheet2.columns = [
            { header: 'Послуга', key: 'service' },
            { header: 'Кількість записів', key: 'appointment_amount' },
            { header: 'Завершені записи', key: 'appointment_succeed' },
            { header: 'Скасовані записи', key: 'appointment_canceled' },
            { header: 'Відсоток скасованих', key: 'appointment_canceled_percent' },
            { header: 'Дохід (UAH)', key: 'revenue' },
            { header: 'Кількість місяців надання послуги', key: 'lifetime' },
            { header: 'Середній дохід на місяць (UAH)', key: 'avg_revenue_by_month' },
        ];        

        servicesResult.rows.forEach(row => {
            worksheet2.addRow({
                service: row.service,
                appointment_amount: row.appointment_amount,
                appointment_succeed: row.appointment_succeed,
                appointment_canceled: row.appointment_canceled,
                appointment_canceled_percent: row.appointment_canceled_percent,
                revenue: row.revenue,
                lifetime: row.lifetime,
                avg_revenue_by_month: row.avg_revenue_by_month,
            });
        });

        res.setHeader('Content-Disposition', 'attachment; filename="report.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("Error generating Excel file:", error);
        res.status(500).send("Error generating the report file.");
    }
});

app.get("/suppliers", async (req, res) => {
    console.log("GET /suppliers");

    const { service_id } = req.query;
    let query = `
        SELECT 
        services_id,
        services_name,
        description,
        price,
        floor(EXTRACT(EPOCH FROM duration)/60) AS duration,
        service_category
        FROM veterinary.services
    `;
    const params = [];

    if (service_id) {
        query += ` WHERE services_id = $1`;
        params.push(service_id);
    }

    try {
        const data = await runDBCommand({ text: query, values: params });
        res.render("services", { services: data.rows });
    } catch (error) {
        console.error("Error fetching services:", error);
        res.status(500).send("Error fetching services.");
    }
});

// GET form to add new service
app.get("/add-service", (req, res) => {
    res.render("add-service");  // you'd create add-service.ejs
});

// POST to create new service
app.post("/add-service", async (req, res) => {
    const { services_name, description, price, duration, service_category } = req.body;
    const query = `
        INSERT INTO veterinary.services (services_name, description, price, duration, service_category)
        VALUES ($1, $2, $3, $4, $5) RETURNING *;
    `;
    try {
        await runDBCommand({ 
          text: query, 
          values: [services_name, description, price, duration, service_category] 
        });
        res.redirect("/suppliers");
    } catch (err) {
        console.error("Error adding service:", err);
        res.status(500).send("Error adding service.");
    }
});

// GET form to update an existing service
app.get("/update-service/:services_id", async (req, res) => {
    const serviceId = req.params.services_id;
    const query = `
        SELECT 
            services_id,
            services_name,
            description,
            price,
            duration::text AS duration,
            service_category
        FROM veterinary.services
        WHERE services_id = $1
    `

    try {
        const { rows } = await runDBCommand({
            text: query,
            values: [serviceId],
        });
        if (rows.length === 0) {
            return res.status(404).send("Service not found.");
        }
        res.render("update-service", { service: rows[0] }); // you'd create update-service.ejs
    } catch (err) {
        console.error("Error fetching service data:", err);
        res.status(500).send("Error fetching service data.");
    }
});

// POST to update service details
app.post("/update-service/:services_id", async (req, res) => {
    const serviceId = req.params.services_id;
    const { services_name, description, price, duration, service_category } = req.body;
    const query = `
        UPDATE veterinary.services
        SET services_name = $1, description = $2, price = $3, duration = $4, service_category = $5
        WHERE services_id = $6
    `;
    try {
        await runDBCommand({
            text: query,
            values: [services_name, description, price, duration, service_category, serviceId],
        });
        res.redirect("/suppliers");
    } catch (err) {
        console.error("Error updating service:", err);
        res.status(500).send("Error updating service.");
    }
});

// POST to delete a service
app.post("/delete-service/:services_id", async (req, res) => {
    const serviceId = req.params.services_id;
    const query = `DELETE FROM veterinary.services WHERE services_id = $1`;
    try {
        await runDBCommand({ text: query, values: [serviceId] });
        res.redirect("/suppliers");
    } catch (err) {
        console.error("Error deleting service:", err);
        res.status(500).send("Error deleting service.");
    }
});

app.get("/owners", async (req, res) => {
    const { owner_id } = req.query;

    let query = "SELECT * FROM veterinary.owners";
    const params = [];

    if (owner_id) {
        query += " WHERE owners_id = $1";
        params.push(owner_id);
    }

    try {
        const result = await runDBCommand({ text: query, values: params });
        res.render("owners", { owners: result.rows });
    } catch (error) {
        console.error("Error fetching owners:", error);
        res.status(500).send("Помилка завантаження власників.");
    }
});


// GET form to add an owner
app.get("/add-owner", (req, res) => {
    res.render("add-owner");
});

// POST form submission for new owner
app.post("/add-owner", async (req, res) => {
    const { last_name, first_name, phone, address, email } = req.body;

    const query = `
        INSERT INTO veterinary.owners (last_name, first_name, phone, address, email)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
    `;
    try {
        await runDBCommand({
            text: query,
            values: [last_name, first_name, phone, address, email],
        });
        res.redirect("/owners");
    } catch (error) {
        console.error("Error adding owner:", error);
        res.status(500).send("Помилка при додаванні власника.");
    }
});


// GET form with existing owner data
app.get("/update-owner/:owners_id", async (req, res) => {
    const ownerId = req.params.owners_id;

    try {
        const { rows } = await runDBCommand({
            text: "SELECT * FROM veterinary.owners WHERE owners_id = $1",
            values: [ownerId],
        });

        if (rows.length === 0) {
            return res.status(404).send("Власника не знайдено.");
        }
        // Render update-owner.ejs, passing in the existing row
        res.render("update-owner", { owner: rows[0] });
    } catch (error) {
        console.error("Error fetching owner data:", error);
        res.status(500).send("Помилка при отриманні даних власника.");
    }
});

// POST to actually update the owner
app.post("/update-owner/:owners_id", async (req, res) => {
    const ownerId = req.params.owners_id;
    const { last_name, first_name, phone, address, email } = req.body;

    const query = `
        UPDATE veterinary.owners
        SET 
            last_name = $1,
            first_name = $2,
            phone = $3,
            address = $4,
            email = $5
        WHERE owners_id = $6
    `;
    try {
        await runDBCommand({
            text: query,
            values: [last_name, first_name, phone, address, email, ownerId],
        });
        res.redirect("/owners");
    } catch (error) {
        console.error("Error updating owner:", error);
        res.status(500).send("Помилка при оновленні власника.");
    }
});

app.get("/attach-owner/:animals_id", async (req, res) => {
    const animalId = req.params.animals_id;

    try {
        // 1) Get the animal info
        const animalResult = await runDBCommand({
            text: "SELECT * FROM veterinary.animals WHERE animals_id = $1",
            values: [animalId],
        });
        if (animalResult.rows.length === 0) {
            return res.status(404).send("Тварину не знайдено.");
        }
        const animal = animalResult.rows[0];

        // 2) Get the list of owners
        const ownersResult = await runDBCommand({
            text: "SELECT owners_id, last_name, first_name FROM veterinary.owners ORDER BY last_name",
        });

        // 3) Render a form page
        res.render("attach-owner", {
            animal,
            owners: ownersResult.rows,
        });
    } catch (error) {
        console.error("Error loading attach-owner form:", error);
        res.status(500).send("Помилка завантаження форми для призначення власника.");
    }
});


app.post("/delete-owner/:owners_id", async (req, res) => {
    const ownerId = req.params.owners_id;
    const query = "DELETE FROM veterinary.owners WHERE owners_id = $1";

    try {
        await runDBCommand({ text: query, values: [ownerId] });
        console.log(`Owner with ID ${ownerId} deleted successfully`);
        res.redirect("/owners");
    } catch (error) {
        console.error("Error deleting owner:", error);
        res.status(500).send("Помилка при видаленні власника.");
    }
});



app.listen(3000, () => {
    console.log("Server is running on port 3000");
});


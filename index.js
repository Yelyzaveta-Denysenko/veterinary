const express = require("express");
const ejs = require("ejs");
const { Client } = require("pg");
const bodyParser = require("body-parser");
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');


async function generateAppointmentPDF(appointment) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        doc.registerFont('DejaVu', 'public/fonts/DejaVuSans.ttf');
        
        doc.font('DejaVu'); 

        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfData = Buffer.concat(buffers);
            resolve(pdfData);
        });
        doc.on('error', reject);

        doc.fontSize(20).fillColor('#0078d7').text('VetAN - Підсумок прийому', { align: 'center' });
        doc.moveDown();

        doc.fontSize(14).fillColor('#000');
        doc.text(`Ідентифікатор прийому: ${appointment.appointment_id}`, { lineGap: 4 });
        doc.text(`Тварина: ${appointment.animal_name} (${appointment.breed}, ${appointment.gender})`, { lineGap: 4 });

        const dateObj = new Date(appointment.appointment_date);
        const isoString = dateObj.toISOString(); 
        const onlyDate = isoString.split("T")[0]; 

        doc.text(`Дата прийому: ${onlyDate}`, { lineGap: 4 });

        doc.text(`Час прийому: ${appointment.appointment_time}`, { lineGap: 4 });
        doc.text(`Послуга: ${appointment.services_name}`, { lineGap: 4 });
        doc.text(`Статус: ${appointment.status}`, { lineGap: 4 });

        doc.moveDown();
        doc.text('----- Медична інформація -----', { lineGap: 6, underline: true });
        doc.text(`Діагноз: ${appointment.diagnosis || 'Немає даних'}`, { lineGap: 3 });
        doc.text(`Лікування: ${appointment.treatment || 'Немає даних'}`, { lineGap: 3 });
        doc.text(`Препарати: ${appointment.preparations || 'Немає даних'}`, { lineGap: 3 });
        doc.fontSize(12).text(`Ветеринар: ${appointment.vet_last_name} ${appointment.vet_first_name}`, { lineGap: 4 });
        doc.text(`Спеціалізація: ${appointment.vet_specialization || 'Немає даних'}`, { lineGap: 4 });


        doc.moveDown();
        doc.text('----- Оплата -----', { lineGap: 6, underline: true });
        doc.text(`Сплачено: ${appointment.payment_amount || '0.00'} грн`, { lineGap: 3 });
        doc.text(`Метод оплати: ${appointment.payment_method || 'N/A'}`, { lineGap: 3 });
        doc.text(`Повна вартість послуги: ${appointment.service_cost || 'N/A'} грн`, { lineGap: 3 });

        doc.end();
    });
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'yelyzaveta.denysenko@nure.ua',
        pass: 'isvp ylin dqsy enqo'
    }
});

async function emailAppointmentSummary(appointment, pdfBuffer) {
    if (!appointment.owner_email) {
        console.log('No owner email found, skipping sending.');
        return;
    }

    const mailOptions = {
        from: '"VetAN Clinic" <yourEmail@gmail.com>',
        to: appointment.owner_email, 
        subject: `Підсумок візиту для ${appointment.animal_name}`,
        text: 'Шановний(а) власнику, у додатку знаходиться підсумок візиту вашої тварини.',
        attachments: [
            {
                filename: `Appointment_${appointment.appointment_id}.pdf`,
                content: pdfBuffer, 
                contentType: 'application/pdf'
            }
        ]
    };

    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully!');
}

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

        const ownersQuery = `
            SELECT owners_id, last_name, first_name 
            FROM veterinary.owners 
            ORDER BY last_name
        `;
        const ownersResult = await runDBCommand({
            text: ownersQuery
        });

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
        const vetsResult = await runDBCommand({ text: "SELECT * FROM veterinary.veterinans" });

        res.render("add-appointment", {
            animals: animalsResult.rows,
            services: servicesResult.rows,
            vets: vetsResult.rows,  // Pass veterinarians to EJS
        });
    } catch (error) {
        console.error("Помилка отримання даних для форми:", error);
        res.status(500).send("Помилка отримання даних для форми.");
    }
});

app.post("/add-appointment", async (req, res) => {
    const { animal_id, service_id, vet_id, appointment_date, appointment_time } = req.body;

    try {
        const query = `
            INSERT INTO veterinary.appointment 
                (appointment_date, appointment_time, animal_id, services_id, vet_id, status)
            VALUES ($1, $2, $3, $4, $5, 'Scheduled') RETURNING *`;

        const result = await runDBCommand({
            text: query,
            values: [appointment_date, appointment_time, animal_id, service_id, vet_id],
        });

        console.log("Новий запис на прийом створено:", result.rows[0]);
        res.redirect("/");
    } catch (error) {
        console.error("Помилка при створенні запису на прийом:", error);
        res.status(500).send("Помилка при створенні запису на прийом.");
    }
});

app.get("/appointments", async (req, res) => {
    const { status, start_date, end_date } = req.query;

    let query = `
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
        WHERE 1=1
    `;
    const params = [];

    if (status) {
        query += ` AND ap.status = $${params.length + 1}`;
        params.push(status);
    }

    if (start_date) {
        query += ` AND ap.appointment_date >= $${params.length + 1}`;
        params.push(start_date);
    }

    if (end_date) {
        query += ` AND ap.appointment_date <= $${params.length + 1}`;
        params.push(end_date);
    }

    try {
        const data = await runDBCommand({ text: query, values: params });

        res.render("appointments", {
            appointments: data.rows,
            filterStatus: status || '',
            startDate: start_date || '',
            endDate: end_date || ''
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
                    (SELECT s.price 
                     FROM veterinary.Appointment a 
                     JOIN veterinary.Services s ON a.services_id = s.services_id 
                     WHERE a.appointment_id = $1), 
                    $2, CURRENT_TIMESTAMP, 'Paid')
        `;
        await runDBCommand({ text: insertQuery, values: [appointmentId, payment_method] });

        const updateQuery = `
            UPDATE veterinary.Appointment 
            SET status = 'Completed'
            WHERE appointment_id = $1
            RETURNING *;
        `;
        await runDBCommand({ text: updateQuery, values: [appointmentId] });

        const fullDataQuery = `
            SELECT 
                a.appointment_id, a.appointment_date, a.appointment_time, a.status, 
                a.status_start_time, a.status_end_time,
                s.services_name, s.price AS service_cost,
                an.name AS animal_name, an.breed, an.gender,
                o.email AS owner_email, o.last_name AS owner_last_name, o.first_name AS owner_first_name,
                mr.diagnosis, mr.treatment, mr.preparations,
                p.operation_method AS payment_method, p.amount AS payment_amount,
                v.last_name AS vet_last_name, v.first_name AS vet_first_name,
                v.specialization AS vet_specialization
            FROM veterinary.appointment a
            JOIN veterinary.services s ON a.services_id = s.services_id
            JOIN veterinary.animals an ON a.animal_id = an.animals_id
            LEFT JOIN veterinary.owners o ON an.owners_id = o.owners_id
            LEFT JOIN veterinary.medical_record mr ON a.appointment_id = mr.appointment_id
            LEFT JOIN veterinary.financial_operation p ON a.appointment_id = p.appointment_id
            LEFT JOIN veterinary.veterinans v ON a.vet_id = v.vet_id
            WHERE a.appointment_id = $1
        `;
        const { rows } = await runDBCommand({ text: fullDataQuery, values: [appointmentId] });
        const appointment = rows[0];

        const pdfBuffer = await generateAppointmentPDF(appointment);

        await emailAppointmentSummary(appointment, pdfBuffer);

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



app.get("/supplies", (req, res) => {
    res.render("supplies");
});

app.get("/reports/monthly", async (req, res) => {
    try {
        const query = `
            WITH service_counts AS (
                SELECT 
                    date_trunc('month', appointment_date) AS business_month,
                    s.services_id,
                    s.services_name,
                    count(ap.services_id) AS service_count
                FROM veterinary.appointment ap
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
                    ROW_NUMBER() OVER (PARTITION BY business_month ORDER BY service_count ASC) AS low_rank
                FROM service_counts
            ),
            monthly_statistic AS (
                SELECT 
                    date_trunc('month', appointment_date) AS business_month,
                    count(*) AS appointment_amount,
                    count(*) FILTER (WHERE status = 'Completed') AS appointment_succeed,
                    count(*) FILTER (WHERE status = 'Cancelled') AS appointment_canceled,
                    FLOOR(
                        CAST(count(*) FILTER (WHERE status = 'Cancelled') AS numeric) 
                        / CAST(count(*) AS numeric) * 100
                    ) AS appointment_canceled_percent,
                    SUM(fo.amount) AS revenue
                FROM veterinary.appointment ap
                LEFT JOIN veterinary.financial_operation fo
                    ON ap.appointment_id = fo.appointment_id
                GROUP BY 1
            )
            SELECT 
                EXTRACT(YEAR FROM ms.business_month) AS year,
                EXTRACT(MONTH FROM ms.business_month) AS month,
                ms.appointment_amount,
                ms.appointment_succeed,
                ms.appointment_canceled,
                ms.appointment_canceled_percent,
                ms.revenue,
                rsh.services_name AS top_service,
                rsl.services_name AS bot_service
            FROM monthly_statistic ms
            LEFT JOIN (
                SELECT * FROM ranked_services WHERE high_rank = 1
            ) rsh
                ON ms.business_month = rsh.business_month
            LEFT JOIN (
                SELECT * FROM ranked_services WHERE low_rank = 1
            ) rsl
                ON ms.business_month = rsl.business_month
        `;
        
        const result = await runDBCommand({ text: query });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Місяці");
        
        worksheet.mergeCells("A1:I1");
        worksheet.getCell("A1").value = "Звітність за місяцями";
        worksheet.getCell("A1").font = { bold: true, size: 14 };
        
        worksheet.mergeCells("A2:I2");
        const now = new Date();
        worksheet.getCell("A2").value = `Дата формування: ${now.toLocaleString("uk-UA")}`;
        
        worksheet.addRow([
            "Рік",
            "Місяць",
            "Кількість записів",
            "Завершені записи",
            "Скасовані записи",
            "Відсоток скасованих",
            "Дохід (UAH)",
            "Найпопулярніша послуга",
            "Найменш популярна послуга",
        ]);
  
        result.rows.forEach(rowData => {
            worksheet.addRow([
            rowData.year,
            rowData.month,
            rowData.appointment_amount,
            rowData.appointment_succeed,
            rowData.appointment_canceled,
            rowData.appointment_canceled_percent,
            rowData.revenue,
            rowData.top_service,
            rowData.bot_service,
            ]);
        });

        res.setHeader('Content-Disposition', 'attachment; filename="monthly-report.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("Error generating monthly Excel file:", error);
        res.status(500).send("Error generating monthly report file.");
    }
});

app.get("/reports/services", async (req, res) => {
    try {
        const servicesQuery = `
            SELECT 
                s.services_name AS service,
                COUNT(*) AS appointment_amount,
                COUNT(*) FILTER (WHERE status = 'Completed') AS appointment_succeed,
                COUNT(*) FILTER (WHERE status = 'Cancelled') AS appointment_canceled,
                FLOOR(
                    CAST(COUNT(*) FILTER (WHERE status = 'Cancelled') AS numeric) 
                    / CAST(COUNT(*) AS numeric) * 100
                ) AS appointment_canceled_percent,
                COALESCE(SUM(fo.amount), 0) AS revenue,
                COUNT(DISTINCT date_trunc('month', appointment_date)) AS lifetime,
                FLOOR(
                    COALESCE(SUM(fo.amount), 0) 
                    / COUNT(DISTINCT date_trunc('month', appointment_date))
                ) AS avg_revenue_by_month
            FROM veterinary.appointment ap
            LEFT JOIN veterinary.services s
                ON ap.services_id = s.services_id
            LEFT JOIN veterinary.financial_operation fo
                ON ap.appointment_id = fo.appointment_id
            GROUP BY s.services_name
        `;
        const servicesResult = await runDBCommand({ text: servicesQuery });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Послуги');

        worksheet.getCell('A1').value = 'Звітність за послугами';
        worksheet.getCell('A1').font = { bold: true, size: 14 };
        worksheet.mergeCells('A1:E1');

        const now = new Date();
        worksheet.getCell('A2').value = `Дата формування: ${now.toLocaleString('uk-UA')}`;
        worksheet.mergeCells('A2:E2');

        worksheet.addRow([
            "Послуга",
            "Кількість записів",
            "Завершені записи",
            "Скасовані записи",
            "Відсоток скасованих",
            "Дохід (UAH)",
            "Кількість місяців надання послуги",
            "Середній дохід на місяць (UAH)",
        ]);

        servicesResult.rows.forEach(row => {
            worksheet.addRow([
                row.service,
                row.appointment_amount,
                row.appointment_succeed,
                row.appointment_canceled,
                row.appointment_canceled_percent,
                row.revenue,
                row.lifetime,
                row.avg_revenue_by_month,
            ]);
        });

        res.setHeader('Content-Disposition', 'attachment; filename="services-report.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("Error generating services Excel file:", error);
        res.status(500).send("Error generating services report file.");
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

app.get("/add-service", (req, res) => {
    res.render("add-service");  
});

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
        res.render("update-service", { service: rows[0] }); 
    } catch (err) {
        console.error("Error fetching service data:", err);
        res.status(500).send("Error fetching service data.");
    }
});

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


app.get("/add-owner", (req, res) => {
    res.render("add-owner");
});

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
        res.render("update-owner", { owner: rows[0] });
    } catch (error) {
        console.error("Error fetching owner data:", error);
        res.status(500).send("Помилка при отриманні даних власника.");
    }
});

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
        const animalResult = await runDBCommand({
            text: "SELECT * FROM veterinary.animals WHERE animals_id = $1",
            values: [animalId],
        });
        if (animalResult.rows.length === 0) {
            return res.status(404).send("Тварину не знайдено.");
        }
        const animal = animalResult.rows[0];

        const ownersResult = await runDBCommand({
            text: "SELECT owners_id, last_name, first_name FROM veterinary.owners ORDER BY last_name",
        });

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

app.get("/veterinans", async (req, res) => {
    const { vet_id } = req.query;
    
    let query = "SELECT * FROM veterinary.veterinans";
    const params = [];

    if (vet_id) {
        query += " WHERE vet_id = $1";
        params.push(vet_id);
    }

    try {
        const result = await runDBCommand({ text: query, values: params });
        res.render("veterinans", { vets: result.rows });
    } catch (error) {
        console.error("Error fetching veterinarians:", error);
        res.status(500).send("Error fetching veterinarians.");
    }
});

app.get("/add-vet", (req, res) => {
    res.render("add-vet");
});

app.post("/add-vet", async (req, res) => {
    const {
        last_name,
        first_name,
        specialization,
        experience,
        working_days,
        working_hours,
        phone,
        education
    } = req.body;

    const query = `
        INSERT INTO veterinary.veterinans 
            (last_name, first_name, specialization, experience, 
             working_days, working_hours, phone, education)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
    `;
    try {
        await runDBCommand({
            text: query,
            values: [
                last_name,
                first_name,
                specialization,
                experience,
                working_days,
                working_hours,
                phone,
                education
            ],
        });
        res.redirect("/veterinans");
    } catch (error) {
        console.error("Error adding veterinarian:", error);
        res.status(500).send("Error adding veterinarian.");
    }
});

app.get("/update-vet/:vet_id", async (req, res) => {
    const vetId = req.params.vet_id;

    try {
        const { rows } = await runDBCommand({
            text: "SELECT * FROM veterinary.veterinans WHERE vet_id = $1",
            values: [vetId],
        });
        if (rows.length === 0) {
            return res.status(404).send("Ветеринара не знайдено.");
        }
        res.render("update-vet", { vet: rows[0] });
    } catch (error) {
        console.error("Error fetching vet data:", error);
        res.status(500).send("Error fetching vet data.");
    }
});

app.post("/update-vet/:vet_id", async (req, res) => {
    const vetId = req.params.vet_id;
    const {
        last_name,
        first_name,
        specialization,
        experience,
        working_days,
        working_hours,
        phone,
        education
    } = req.body;

    const query = `
        UPDATE veterinary.veterinans
        SET 
            last_name = $1,
            first_name = $2,
            specialization = $3,
            experience = $4,
            working_days = $5,
            working_hours = $6,
            phone = $7,
            education = $8
        WHERE vet_id = $9
    `;
    try {
        await runDBCommand({
            text: query,
            values: [
                last_name,
                first_name,
                specialization,
                experience,
                working_days,
                working_hours,
                phone,
                education,
                vetId
            ],
        });
        res.redirect("/veterinans");
    } catch (error) {
        console.error("Error updating veterinarian:", error);
        res.status(500).send("Error updating veterinarian.");
    }
});

app.post("/delete-vet/:vet_id", async (req, res) => {
    const vetId = req.params.vet_id;
    const query = `DELETE FROM veterinary.veterinans WHERE vet_id = $1`;

    try {
        await runDBCommand({ text: query, values: [vetId] });
        console.log(`Vet with ID ${vetId} deleted successfully`);
        res.redirect("/veterinans");
    } catch (error) {
        console.error("Error deleting veterinarian:", error);
        res.status(500).send("Error deleting veterinarian.");
    }
});


app.listen(3000, () => {
    console.log("Server is running on port 3000");
});













import pandas as pd
import random
from datetime import datetime, timedelta

random.seed(42)

indian_names = [
    "Rahul Sharma", "Priya Singh", "Amit Kumar", "Neha Gupta", "Vikram Patel",
    "Sunita Verma", "Rajesh Yadav", "Pooja Mehta", "Arun Tiwari", "Kavita Joshi",
    "Suresh Nair", "Anita Desai", "Manish Agarwal", "Deepa Pillai", "Rohit Bhatia",
    "Sonia Kapoor", "Ashok Malhotra", "Rekha Iyer", "Vinod Chauhan", "Meena Saxena"
]

cities = ["Mumbai", "Delhi", "Bangalore", "Chennai", "Kolkata", "Hyderabad", "Pune", "Ahmedabad"]
device_types = ["Mobile", "Desktop", "Tablet"]
os_types = ["Android", "iOS", "Windows", "MacOS"]
account_types = ["Savings", "Current", "Salary"]
kyc_statuses = ["Verified", "Pending", "Unverified"]

base_time = datetime.now()

rows = []

# --- FRAUD PATTERN 1: Circular transactions ACC001->ACC002->ACC003->ACC001 ---
for i in range(20):
    t = base_time - timedelta(hours=random.randint(1, 48))
    cycle = [("ACC001", "ACC002"), ("ACC002", "ACC003"), ("ACC003", "ACC001")]
    fa, ta = cycle[i % 3]
    rows.append({
        "user_id": f"USER00{(i%3)+1}",
        "user_name": indian_names[i % 3],
        "kyc_status": "Verified",
        "account_id": fa,
        "account_type": "Current",
        "balance": random.randint(10000, 500000),
        "created_date": (base_time - timedelta(days=365)).strftime("%Y-%m-%d"),
        "transaction_id": f"TXN_CYCLE_{i:03d}",
        "amount": random.choice([10000, 20000, 50000]),
        "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
        "status": "Completed",
        "from_account": fa,
        "to_account": ta,
        "device_id": f"DEV00{(i%3)+1}",
        "device_type": "Mobile",
        "os": "Android",
        "ip_id": f"IP_10.0.0.{(i%3)+1}",
        "country": "India",
        "city": "Mumbai"
    })

# --- FRAUD PATTERN 2: Shared device DEV001 used by multiple users ---
shared_users = ["USER001", "USER005", "USER009", "USER013"]
for i, uid in enumerate(shared_users):
    for j in range(5):
        t = base_time - timedelta(hours=random.randint(1, 72))
        rows.append({
            "user_id": uid,
            "user_name": indian_names[i],
            "kyc_status": random.choice(["Verified", "Unverified"]),
            "account_id": f"ACC_SD_{i}{j}",
            "account_type": "Savings",
            "balance": random.randint(1000, 50000),
            "created_date": (base_time - timedelta(days=random.randint(1, 30))).strftime("%Y-%m-%d"),
            "transaction_id": f"TXN_SD_{i}_{j:03d}",
            "amount": random.randint(500, 15000),
            "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "Completed",
            "from_account": f"ACC_SD_{i}{j}",
            "to_account": f"ACC_{random.randint(100,999)}",
            "device_id": "DEV001",
            "device_type": "Mobile",
            "os": "Android",
            "ip_id": f"IP_192.168.1.{random.randint(1,255)}",
            "country": "India",
            "city": "Delhi"
        })

# --- FRAUD PATTERN 3: USER007 high frequency - 15 transactions in 1 hour ---
burst_time = base_time - timedelta(hours=2)
for i in range(15):
    t = burst_time + timedelta(minutes=i*3)
    rows.append({
        "user_id": "USER007",
        "user_name": "Rajesh Yadav",
        "kyc_status": "Verified",
        "account_id": "ACC007",
        "account_type": "Savings",
        "balance": 200000,
        "created_date": (base_time - timedelta(days=180)).strftime("%Y-%m-%d"),
        "transaction_id": f"TXN_HF_{i:03d}",
        "amount": random.randint(500, 5000),
        "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
        "status": "Completed",
        "from_account": "ACC007",
        "to_account": f"ACC_{random.randint(200,299)}",
        "device_id": "DEV007",
        "device_type": "Mobile",
        "os": "iOS",
        "ip_id": "IP_172.16.0.7",
        "country": "India",
        "city": "Bangalore"
    })

# --- FRAUD PATTERN 4: New accounts with large transfers ---
for i in range(10):
    rows.append({
        "user_id": f"USER_NEW_{i:03d}",
        "user_name": indian_names[i % len(indian_names)],
        "kyc_status": "Unverified",
        "account_id": f"ACC_NEW_{i:03d}",
        "account_type": "Savings",
        "balance": random.randint(50000, 200000),
        "created_date": base_time.strftime("%Y-%m-%d"),
        "transaction_id": f"TXN_NEW_{i:03d}",
        "amount": random.randint(50000, 100000),
        "timestamp": (base_time - timedelta(hours=random.randint(1,5))).strftime("%Y-%m-%d %H:%M:%S"),
        "status": "Completed",
        "from_account": f"ACC_NEW_{i:03d}",
        "to_account": f"ACC_{random.randint(300,399)}",
        "device_id": f"DEV_NEW_{i:03d}",
        "device_type": random.choice(device_types),
        "os": random.choice(os_types),
        "ip_id": f"IP_10.10.{i}.1",
        "country": "India",
        "city": random.choice(cities)
    })

# --- NORMAL TRANSACTIONS: 380 rows ---
for i in range(380):
    t = base_time - timedelta(days=random.randint(0,7), hours=random.randint(0,23))
    uid = f"USER_{i:04d}"
    aid = f"ACC_{i:04d}"
    rows.append({
        "user_id": uid,
        "user_name": random.choice(indian_names),
        "kyc_status": random.choice(kyc_statuses),
        "account_id": aid,
        "account_type": random.choice(account_types),
        "balance": random.randint(5000, 500000),
        "created_date": (base_time - timedelta(days=random.randint(30,1000))).strftime("%Y-%m-%d"),
        "transaction_id": f"TXN_{i:04d}",
        "amount": random.randint(500, 45000),
        "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
        "status": random.choice(["Completed", "Completed", "Completed", "Failed"]),
        "from_account": aid,
        "to_account": f"ACC_{random.randint(1000,9999)}",
        "device_id": f"DEV_{random.randint(1,50):03d}",
        "device_type": random.choice(device_types),
        "os": random.choice(os_types),
        "ip_id": f"IP_{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}",
        "country": "India",
        "city": random.choice(cities)
    })

df = pd.DataFrame(rows)
df = df.sample(frac=1, random_state=42).reset_index(drop=True)
df.to_csv("sample_data.csv", index=False)
print(f"Generated {len(df)} rows → sample_data.csv")
print(f"Fraud patterns included: circular txns, shared device, high frequency, new account large transfers")
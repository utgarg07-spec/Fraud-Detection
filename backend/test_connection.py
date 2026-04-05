from dotenv import load_dotenv
load_dotenv()

import requests
import os

load_dotenv()

from tigergraph import connect_to_tigergraph

try:
    conn = connect_to_tigergraph()
    print("Connection SUCCESS")

    gsql_query = """
CREATE VERTEX User (PRIMARY_ID id STRING, name STRING, kyc_status STRING, risk_score DOUBLE)
CREATE VERTEX Account (PRIMARY_ID id STRING, user_id STRING, account_type STRING, balance DOUBLE)
CREATE VERTEX Transaction (PRIMARY_ID id STRING, amount DOUBLE, timestamp STRING, status STRING, risk_score DOUBLE)
CREATE VERTEX Device (PRIMARY_ID id STRING, device_type STRING, os STRING)
CREATE VERTEX IPAddress (PRIMARY_ID id STRING, country STRING, city STRING)
CREATE DIRECTED EDGE OWNS_ACCOUNT (FROM User, TO Account)
CREATE DIRECTED EDGE MADE_TRANSACTION (FROM Account, TO Transaction)
CREATE DIRECTED EDGE RECEIVED_BY (FROM Transaction, TO Account)
CREATE DIRECTED EDGE USES_DEVICE (FROM User, TO Device)
CREATE DIRECTED EDGE CONNECTED_FROM (FROM User, TO IPAddress)
CREATE DIRECTED EDGE SHARES_DEVICE (FROM User, TO User)
CREATE GRAPH FraudNet (User, Account, Transaction, Device, IPAddress, OWNS_ACCOUNT, MADE_TRANSACTION, RECEIVED_BY, USES_DEVICE, CONNECTED_FROM, SHARES_DEVICE)
"""

    # Send as plain text body
    url = f"{conn['host']}/gsql/v1/statements"
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {conn['token']}",
            "Content-Type": "text/plain"
        },
        data=gsql_query.encode("utf-8"),
        timeout=60
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text[:500]}")

except Exception as e:
    print(f"Failed: {e}")
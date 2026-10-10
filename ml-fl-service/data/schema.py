from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass(frozen=True)
class Schema:
    key: str
    task: str
    target: str
    id_col: str
    client_col: str
    numeric: List[str]
    categorical: List[str]
    raw_required: List[str]
    time_col: Optional[str] = None
    record_col: str = "record_id"
    vfl_groups: Dict[str, List[str]] = field(default_factory=dict)

    @property
    def model_features(self) -> List[str]:
        return [*self.numeric, *self.categorical]

    @property
    def processed_required(self) -> List[str]:
        columns = [self.record_col, self.id_col, self.client_col, self.target, *self.model_features, "is_synthetic"]
        if self.time_col:
            columns.append(self.time_col)
        return list(dict.fromkeys(columns))


PAYSIM = Schema(
    key="paysim_banks",
    task="fraud",
    target="isFraud",
    id_col="customer_id",
    client_col="institution_id",
    time_col="step",
    raw_required=[
        "step",
        "type",
        "amount",
        "nameOrig",
        "oldbalanceOrg",
        "newbalanceOrig",
        "nameDest",
        "oldbalanceDest",
        "newbalanceDest",
        "isFraud",
        "BankID",
    ],
    numeric=[
        "amount",
        "oldbalanceOrg",
        "newbalanceOrig",
        "oldbalanceDest",
        "newbalanceDest",
        "amt_log",
        "orig_delta",
        "dest_delta",
        "orig_zero_after",
        "dest_zero_before",
        "amt_to_bal_ratio",
        "hour",
        "is_night",
        "orig_tx_count_24",
        "orig_amt_sum_24",
        "dest_in_degree",
        "dest_out_degree",
        "orig_pagerank",
    ],
    categorical=["type"],
    vfl_groups={
        "bank": ["amount", "amt_log", "amt_to_bal_ratio", "oldbalanceOrg", "type"],
        "lending_app": ["hour", "is_night", "orig_tx_count_24", "orig_amt_sum_24"],
        "insurer": ["oldbalanceDest", "dest_in_degree", "dest_out_degree", "orig_pagerank"],
    },
)

GMSC = Schema(
    key="gmsc",
    task="default",
    target="SeriousDlqin2yrs",
    id_col="customer_id",
    client_col="institution_id",
    raw_required=[
        "SeriousDlqin2yrs",
        "RevolvingUtilizationOfUnsecuredLines",
        "age",
        "NumberOfTime30-59DaysPastDueNotWorse",
        "DebtRatio",
        "MonthlyIncome",
        "NumberOfOpenCreditLinesAndLoans",
        "NumberOfTimes90DaysLate",
        "NumberRealEstateLoansOrLines",
        "NumberOfTime60-89DaysPastDueNotWorse",
        "NumberOfDependents",
    ],
    numeric=[
        "RevolvingUtilizationOfUnsecuredLines",
        "age",
        "NumberOfTime30-59DaysPastDueNotWorse",
        "DebtRatio",
        "MonthlyIncome",
        "NumberOfOpenCreditLinesAndLoans",
        "NumberOfTimes90DaysLate",
        "NumberRealEstateLoansOrLines",
        "NumberOfTime60-89DaysPastDueNotWorse",
        "NumberOfDependents",
        "income_log",
        "income_missing",
        "total_past_due",
        "util_clipped",
        "debt_income",
        "age_band",
        "dependents_per_income",
    ],
    categorical=[],
    vfl_groups={
        "bank": [
            "RevolvingUtilizationOfUnsecuredLines",
            "NumberOfOpenCreditLinesAndLoans",
            "NumberRealEstateLoansOrLines",
            "util_clipped",
            "total_past_due",
        ],
        "lending_app": ["DebtRatio", "MonthlyIncome", "income_log", "income_missing", "debt_income"],
        "insurer": ["age", "NumberOfDependents", "age_band", "dependents_per_income"],
    },
)

SCHEMAS = {schema.key: schema for schema in (PAYSIM, GMSC)}


def validate_columns(columns, required, context):
    missing = sorted(set(required) - set(columns))
    if missing:
        raise ValueError("{} is missing required columns: {}".format(context, ", ".join(missing)))

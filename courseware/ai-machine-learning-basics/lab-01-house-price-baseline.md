# 实验 1 房价预测基线模型

## 实验目标

通过一个小型回归任务跑通“读取数据、划分数据、训练基线、评估误差、记录结论”的完整流程。实验重点不是追求最低误差，而是建立可复现的机器学习项目骨架。

## 示例数据

| area | rooms | age | distance_to_subway | price |
|---:|---:|---:|---:|---:|
| 68 | 2 | 12 | 1.8 | 312 |
| 90 | 3 | 5 | 0.9 | 468 |
| 55 | 1 | 18 | 3.2 | 220 |
| 110 | 3 | 2 | 1.1 | 610 |
| 76 | 2 | 9 | 2.4 | 350 |

## 起始代码

```python
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

df = pd.read_csv("house_price_sample.csv")
features = ["area", "rooms", "age", "distance_to_subway"]
target = "price"

train_df, valid_df = train_test_split(df, test_size=0.2, random_state=42)

model = LinearRegression()
model.fit(train_df[features], train_df[target])

pred = model.predict(valid_df[features])
mae = mean_absolute_error(valid_df[target], pred)
print({"valid_mae": round(mae, 2)})
```

## 验收标准

1. 能解释每个特征为什么预测时可获得。
2. 能说明为什么不能把 `price` 同时放入特征和标签。
3. 能输出验证集 MAE，并与“预测训练集均价”的朴素基线比较。
4. 能写出至少一条误差偏大的样本分析。

## 常见错误

- 在划分前根据全量数据做标准化或异常值处理。
- 只报告训练集误差，不报告验证集误差。
- 忽略样本量过小导致的评估不稳定。

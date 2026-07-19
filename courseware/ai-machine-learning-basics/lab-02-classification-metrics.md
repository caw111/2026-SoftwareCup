# 实验 2 分类指标与混淆矩阵

## 实验目标

通过二分类预测理解 Accuracy、Precision、Recall 和 F1 的差异，并学习在样本不均衡时选择更合适的评价指标。

## 任务背景

某学习平台希望预测学生是否需要补救学习。正类表示“需要补救”，负类表示“暂不需要”。如果漏掉需要补救的学生，后续学习路径会继续变难；如果误判为需要补救，学生只是多做一些基础练习。

## 指标解释

- Precision：被预测为需要补救的学生中，有多少真的需要补救。
- Recall：所有真的需要补救的学生中，有多少被系统找出来。
- F1：Precision 和 Recall 的调和平均。

## 起始代码

```python
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix

y_true = [1, 0, 1, 1, 0, 0, 0, 1, 0, 0]
y_pred = [1, 0, 0, 1, 0, 0, 0, 0, 0, 0]

print("accuracy", accuracy_score(y_true, y_pred))
print("precision", precision_score(y_true, y_pred))
print("recall", recall_score(y_true, y_pred))
print("f1", f1_score(y_true, y_pred))
print(confusion_matrix(y_true, y_pred))
```

## 思考问题

如果系统目标是尽早发现需要补救的学生，应优先提高 Precision 还是 Recall？请结合业务后果说明理由。

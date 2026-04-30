def walk_forward_split(df, train_size=0.7):
    split = int(len(df) * train_size)
    return df[:split], df[split:]
